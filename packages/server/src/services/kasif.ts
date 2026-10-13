import {
  dedupeKeys,
  detectCity,
  detectLink,
  fetchSite,
  foldTurkish,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  type ImportRow,
  type LLMService,
} from '@papi/core';
import type { InstagramDiscovery } from '../adapters/instagram.ts';
import type { CompanySource, NewCompany, Repo } from '../repo/types.ts';

export interface KasifDeps {
  repo: Repo;
  llm: LLMService;
  fetchFn?: typeof fetch;
  instagram?: InstagramDiscovery | null;
}

export type AddResult =
  | {
      status: 'created' | 'existing';
      companyId: string;
      name: string;
      analyzable: boolean;
      note?: string;
    }
  | { status: 'unsupported'; message: string };

const today = () => new Date().toISOString().slice(0, 10);

function baseCompany(
  name: string,
  source: CompanySource,
  extra: Partial<NewCompany> = {},
): NewCompany {
  const keys = dedupeKeys({
    name,
    website: extra.website_url ?? null,
    phone: extra.phone_e164 ?? null,
    instagram: extra.instagram_handle ?? null,
    city: extra.city ?? null,
  });
  return {
    name: name.trim().slice(0, 200),
    name_norm: keys.nameNorm,
    source,
    stage: 'new',
    next_step_kind: 'waiting',
    waiting_reason: 'Analiz kuyruğunda',
    waiting_until: today(),
    ...extra,
  };
}

/** Creates a company unless a duplicate exists (K-8.10). Returns the id and whether it was new. */
export async function upsertCompany(
  repo: Repo,
  input: NewCompany,
): Promise<{ id: string; created: boolean }> {
  const existing = await repo.findCompany(
    dedupeKeys({
      name: input.name,
      website: input.domain ?? input.website_url ?? null,
      phone: input.phone_e164 ?? null,
      instagram: input.instagram_handle ?? null,
      city: input.city ?? null,
    }),
  );
  if (existing) return { id: existing.id, created: false };
  const id = await repo.createCompany(input);
  await repo.addCompanyEvent(id, 'created', `Kaynak: ${input.source}`);
  return { id, created: true };
}

/** K-8.6: a link sent from Telegram becomes a company. Analysis is the caller's next step. */
export async function addFromLink(
  deps: KasifDeps,
  link: string,
  source: CompanySource = 'telegram',
): Promise<AddResult> {
  const kind = detectLink(link);
  if (!kind)
    return {
      status: 'unsupported',
      message: 'Bu linki anlayamadım. Site, Instagram veya Google Haritalar linki gönderebilirsin.',
    };

  if (kind.kind === 'website') {
    const site = await fetchSite(kind.url, deps.fetchFn ?? fetch).catch(() => null);
    const name = cleanTitle(site?.signals.title) ?? kind.domain;
    const r = await upsertCompany(
      deps.repo,
      baseCompany(name, source, {
        domain: kind.domain,
        website_url: site?.finalUrl ?? kind.url,
        source_ref: link,
      } as Partial<NewCompany>),
    );
    return { status: r.created ? 'created' : 'existing', companyId: r.id, name, analyzable: true };
  }

  if (kind.kind === 'instagram') {
    const profile = deps.instagram
      ? await deps.instagram.lookup(kind.handle).catch(() => null)
      : null;
    const website = profile?.website ? normalizeDomain(profile.website) : null;
    const name = profile?.name ?? `@${kind.handle}`;
    const r = await upsertCompany(
      deps.repo,
      baseCompany(name, 'instagram', {
        instagram_handle: kind.handle,
        ...(website ? { domain: website, website_url: profile?.website ?? null } : {}),
        city: detectCity(profile?.biography),
      }),
    );
    if (!profile) {
      return {
        status: r.created ? 'created' : 'existing',
        companyId: r.id,
        name,
        analyzable: false,
        note: deps.instagram
          ? 'Instagram hesabı işletme hesabı değil veya bulunamadı; site linki gönderirsen analiz ederim.'
          : 'Instagram bağlantısı (Meta uygulaması) henüz kurulmadı; site linki gönderirsen hemen analiz ederim.',
      };
    }
    return { status: r.created ? 'created' : 'existing', companyId: r.id, name, analyzable: true };
  }

  if (kind.kind === 'maps') {
    if (!kind.name) {
      return {
        status: 'unsupported',
        message:
          'Kısa harita linkinden işletme adını okuyamıyorum (harita kazıması yapmıyoruz, K-8.9). İşletmenin sitesini veya Instagram linkini gönder.',
      };
    }
    const found = await findWebsiteByName(deps, kind.name).catch(() => null);
    const r = await upsertCompany(
      deps.repo,
      baseCompany(kind.name, 'telegram', {
        maps_url: kind.url,
        ...(found ? { domain: found.domain, website_url: found.url } : {}),
      }),
    );
    return {
      status: r.created ? 'created' : 'existing',
      companyId: r.id,
      name: kind.name,
      analyzable: true,
      ...(found ? {} : { note: 'Sitesini bulamadım; web sitesi yokmuş gibi değerlendirdim.' }),
    };
  }

  return {
    status: 'unsupported',
    message:
      'Bu link türünü henüz desteklemiyorum. Site, Instagram veya Google Haritalar linki gönder.',
  };
}

function cleanTitle(title: string | null | undefined): string | null {
  if (!title) return null;
  const first = title.split(/\s[|–—-]\s/)[0]?.trim();
  return first && first.length >= 2 ? first.slice(0, 120) : null;
}

/** Grounded web search for an official site, verified by fetching it (K-8.1: never trust unverified results). */
export async function findWebsiteByName(
  deps: KasifDeps,
  name: string,
  city?: string | null,
): Promise<{ domain: string; url: string } | null> {
  const res = await deps.llm.generate({
    agent: 'kasif',
    task: 'kasif.find_website',
    tier: 'light',
    dataClass: 'public',
    grounding: true,
    messages: [
      {
        role: 'user',
        content: `"${name}"${city ? ` (${city})` : ''} adlı işletmenin resmi web sitesinin adresi nedir? Yalnızca adresi yaz; bilmiyorsan "yok" yaz.`,
      },
    ],
  });
  const candidates = [
    ...new Set([
      ...(res.text.match(/[a-z0-9.-]+\.[a-z]{2,}(?:\.[a-z]{2})?/gi) ?? []),
      ...(res.sources ?? []).map((s) => s.title ?? ''),
    ]),
  ]
    .map((c) => normalizeDomain(c))
    .filter(
      (d): d is string =>
        Boolean(d) &&
        !/(google|facebook|instagram|youtube|wikipedia|yelp|tripadvisor|sahibinden|linkedin)\./.test(
          d ?? '',
        ),
    );
  for (const domain of candidates.slice(0, 3)) {
    const site = await fetchSite(`https://${domain}/`, deps.fetchFn ?? fetch).catch(() => null);
    if (site && looksLike(name, site.signals.title, site.signals.textSample))
      return { domain, url: site.finalUrl };
  }
  return null;
}

function looksLike(name: string, ...texts: (string | null)[]): boolean {
  const tokens = foldTurkish(name)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const hay = foldTurkish(texts.filter(Boolean).join(' '));
  const hits = tokens.filter((t) => hay.includes(t)).length;
  return tokens.length > 0 && hits / tokens.length >= 0.5;
}

export interface ImportSummary {
  created: string[];
  duplicates: number;
  invalid: number;
}

/** CSV / OSM / grounding rows → companies, de-duplicated (K-8.5, K-8.10). */
export async function importRows(
  repo: Repo,
  rows: ImportRow[],
  source: CompanySource,
): Promise<ImportSummary> {
  const out: ImportSummary = { created: [], duplicates: 0, invalid: 0 };
  for (const row of rows) {
    if (!row.name?.trim()) {
      out.invalid++;
      continue;
    }
    const domain = row.website ? normalizeDomain(row.website) : null;
    const phone = row.phone ? normalizePhone(row.phone) : null;
    const email = row.email ? normalizeEmail(row.email) : null;
    try {
      const r = await upsertCompany(
        repo,
        baseCompany(row.name, source, {
          domain,
          website_url: domain
            ? row.website?.startsWith('http')
              ? row.website
              : `https://${domain}/`
            : null,
          phone_e164: phone,
          emails: email ? [email] : [],
          city: row.city ?? detectCity(row.address),
          district: row.district ?? null,
          address: row.address ?? null,
          instagram_handle: row.instagram ? row.instagram.replace(/^@/, '').toLowerCase() : null,
          sector: row.sector ?? null,
        }),
      );
      if (r.created) out.created.push(r.id);
      else out.duplicates++;
    } catch {
      out.duplicates++; // unique index race: treat as duplicate
    }
  }
  return out;
}

/** OSM tag filters per sector (K-8.2). */
export const OSM_SECTOR_TAGS: Record<string, string[]> = {
  clinic: ['amenity~"^(clinic|dentist|doctors)$"', 'healthcare~"^(clinic|dentist|doctor|centre)$"'],
  real_estate: ['office="estate_agent"'],
  auto: ['shop~"^(car|car_repair)$"'],
  hotel: ['tourism~"^(hotel|guest_house|motel)$"'],
  education: ['amenity~"^(school|college|kindergarten|language_school|driving_school)$"'],
  construction: [
    'craft~"^(builder|carpenter|tiler|plumber|electrician)$"',
    'office="construction_company"',
  ],
  manufacturing: ['man_made="works"', 'industrial'],
};

export function overpassQuery(area: string, sectors: string[], limit = 150): string {
  const safeArea = area.replace(/["\\]/g, '');
  const parts = sectors
    .flatMap((s) => OSM_SECTOR_TAGS[s] ?? [])
    .map((tag) => `  nwr(area.a)[${tag}][name];`);
  return `[out:json][timeout:60];\narea["name"="${safeArea}"]["boundary"="administrative"]->.a;\n(\n${parts.join('\n')}\n);\nout center tags ${limit};`;
}

export function osmElementsToRows(json: unknown, area: string): ImportRow[] {
  const elements = (json as { elements?: { tags?: Record<string, string> }[] }).elements ?? [];
  return elements
    .map((e) => e.tags ?? {})
    .filter((t) => t.name)
    .map((t) => ({
      name: t.name ?? '',
      website: t.website ?? t['contact:website'],
      phone: t.phone ?? t['contact:phone'],
      email: t.email ?? t['contact:email'],
      city: t['addr:province'] ?? t['addr:city'] ?? area,
      district: t['addr:district'],
      address:
        [t['addr:street'], t['addr:housenumber'], t['addr:district'], t['addr:city']]
          .filter(Boolean)
          .join(' ') || undefined,
      instagram: t['contact:instagram']
        ?.replace(/^https?:\/\/(www\.)?instagram\.com\//, '')
        .replace(/\/$/, ''),
    }));
}

/** Overpass search (K-8.2); polite: one query, identifying User-Agent. */
export async function osmSearch(
  deps: KasifDeps,
  area: string,
  sectors: string[],
): Promise<ImportSummary> {
  const res = await (deps.fetchFn ?? fetch)('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'user-agent': 'PapiBot/1.0 (+https://ajnadigitalagency.com)',
    },
    body: new URLSearchParams({ data: overpassQuery(area, sectors) }).toString(),
  });
  if (!res.ok) throw new Error(`overpass error ${res.status}`);
  return importRows(deps.repo, osmElementsToRows(await res.json(), area), 'osm');
}

/** K-8.1: "businesses of type X in region Y" via grounded search; each site is verified before it enters the CRM. */
export async function groundedSearch(
  deps: KasifDeps,
  query: string,
  max = 10,
): Promise<ImportSummary> {
  const res = await deps.llm.generate({
    agent: 'kasif',
    task: 'kasif.grounded_search',
    tier: 'light',
    dataClass: 'public',
    grounding: true,
    messages: [
      {
        role: 'user',
        content: `${query}\n\nEn fazla ${max} işletme listele. Her satıra yalnızca "İşletme adı | web sitesi adresi" yaz; sitesi bilinmiyorsa "yok" yaz. Başka açıklama ekleme.`,
      },
    ],
  });
  const rows: ImportRow[] = [];
  for (const line of res.text.split('\n').slice(0, max)) {
    const [rawName, rawSite] = line
      .replace(/^[\s*\-\d.]+/, '')
      .split('|')
      .map((s) => s.trim());
    if (!rawName || !rawSite || /^yok$/i.test(rawSite)) continue;
    const domain = normalizeDomain(rawSite);
    if (!domain) continue;
    const site = await fetchSite(`https://${domain}/`, deps.fetchFn ?? fetch).catch(() => null);
    if (!site || !looksLike(rawName, site.signals.title, site.signals.textSample)) continue; // unverified → skipped
    rows.push({ name: rawName, website: site.finalUrl, city: detectCity(query) ?? undefined });
  }
  return importRows(deps.repo, rows, 'grounding');
}
