import type { Settings } from '../settings/schema.ts';
import { detectCity, regionPriority } from './geo.ts';
import { extractSignals, MAX_HTML_BYTES, mergeSignals, type SiteSignals } from './html.ts';
import { pageSpeedUrl, parsePageSpeed, type PageSpeedResult } from './pagespeed.ts';
import { computeScore, playbookForScore, type ScoreResult } from './scoring.ts';
import { detectSector, tierForSectorLabel } from './sector.ts';
import type { SummaryOutput } from './summary.ts';

export const USER_AGENT = 'Mozilla/5.0 (compatible; PapiBot/1.0; +https://ajnadigitalagency.com)';

export interface FetchedSite {
  finalUrl: string;
  signals: SiteSignals;
}

/** Fetches the home page (and the contact page if linked) and extracts signals. Null if unreachable. */
export async function fetchSite(
  url: string,
  fetchFn: typeof fetch = fetch,
  timeoutMs = 10_000,
): Promise<FetchedSite | null> {
  const get = async (u: string) => {
    const res = await fetchFn(u, {
      redirect: 'follow',
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'tr,en;q=0.5',
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('html')) return null;
    return { url: res.url || u, html: await readLimited(res) };
  };
  let home: { url: string; html: string } | null;
  try {
    home = await get(url);
  } catch {
    home = null;
  }
  if (!home) return null;
  const homeSignals = extractSignals(home.html, home.url);
  let contact: SiteSignals | null = null;
  if (homeSignals.contactPageUrl && homeSignals.contactPageUrl !== home.url) {
    try {
      const c = await get(homeSignals.contactPageUrl);
      if (c) contact = extractSignals(c.html, c.url);
    } catch {
      contact = null;
    }
  }
  return { finalUrl: home.url, signals: mergeSignals(homeSignals, contact) };
}

async function readLimited(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (size < MAX_HTML_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
  }
  await reader.cancel().catch(() => undefined);
  const all = new Uint8Array(Math.min(size, MAX_HTML_BYTES));
  let off = 0;
  for (const c of chunks) {
    const part = c.subarray(0, Math.max(0, all.length - off));
    all.set(part, off);
    off += part.length;
  }
  return new TextDecoder('utf-8').decode(all);
}

export async function fetchPageSpeed(
  url: string,
  strategy: 'mobile' | 'desktop',
  apiKey: string | undefined,
  fetchFn: typeof fetch = fetch,
): Promise<PageSpeedResult | null> {
  try {
    const res = await fetchFn(pageSpeedUrl(url, strategy, apiKey), {
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) return null;
    return parsePageSpeed(await res.json(), strategy);
  } catch {
    return null;
  }
}

export interface ScoredCompany {
  sector: string | null;
  sectorSource: 'rule' | 'model' | 'source' | null;
  city: string | null;
  score: ScoreResult;
  playbook: 'soguk_ana' | 'hafif_soguk' | null;
  contacts: { phones: string[]; emails: string[]; decisionMakers: string[] };
}

/** Combines rule signals, PageSpeed and the model summary into a score (K-9.3) and a next step (K-9.4). */
export function scoreCompany(input: {
  name: string;
  knownSector: string | null;
  knownCity: string | null;
  address: string | null;
  knownPhone: string | null;
  knownEmail: string | null;
  instagram: string | null;
  site: SiteSignals | null;
  mobile: PageSpeedResult | null;
  summary: SummaryOutput | null;
  activeSignals: string[];
  settings: Pick<Settings, 'scoring' | 'region_priority'>;
  now?: Date;
}): ScoredCompany {
  const s = input.site;
  const rule = detectSector(input.name, s?.title, s?.description, s?.textSample);
  const sector = rule?.label ?? input.knownSector ?? input.summary?.sector ?? null;
  const sectorSource: ScoredCompany['sectorSource'] = rule
    ? 'rule'
    : input.knownSector
      ? 'source'
      : input.summary?.sector
        ? 'model'
        : null;
  const tier =
    rule?.tier ??
    tierForSectorLabel(input.knownSector) ??
    tierForSectorLabel(input.summary?.sector ?? null);
  const city =
    input.knownCity ??
    detectCity(input.address) ??
    detectCity(s?.textSample) ??
    input.summary?.city ??
    null;

  const phones = [
    ...new Set([input.knownPhone, ...(s?.phones ?? [])].filter((p): p is string => Boolean(p))),
  ];
  const emails = [
    ...new Set([input.knownEmail, ...(s?.emails ?? [])].filter((e): e is string => Boolean(e))),
  ];
  const socialCount =
    Object.keys(s?.socials ?? {}).length + (input.instagram && !s?.socials.instagram ? 1 : 0);
  const channels = [
    phones.length > 0,
    emails.length > 0,
    socialCount > 0,
    Boolean(s?.whatsapp),
  ].filter(Boolean).length;
  const year = (input.now ?? new Date()).getFullYear();
  const maxPriority = input.settings.region_priority.reduce((m, p) => Math.max(m, p.priority), 1);

  const score = computeScore(
    {
      sectorTier: tier,
      sectorLabel: sector,
      regionPriority: regionPriority(city, input.settings.region_priority),
      maxRegionPriority: maxPriority,
      size: { branches: Boolean(s?.branches), manyChannels: socialCount >= 3 },
      site: {
        exists: Boolean(s),
        https: s?.https ?? false,
        mobilePerformance: input.mobile?.performance ?? null,
        whatsapp: s?.whatsapp ?? false,
        booking: s?.booking ?? false,
        onlineOrder: s?.onlineOrder ?? false,
        contactForm: s?.hasContactForm ?? false,
        chatWidget: Boolean(s?.chatWidget),
        socialCount,
        stale:
          s?.copyrightYear !== null && s?.copyrightYear !== undefined && s.copyrightYear < year - 2,
      },
      activeSignals: input.activeSignals,
      reach: {
        phone: phones.length > 0,
        email: emails.length > 0,
        decisionMaker: (s?.decisionMakerHints.length ?? 0) > 0,
        channels,
      },
    },
    input.settings.scoring,
  );
  return {
    sector,
    sectorSource,
    city,
    score,
    playbook: playbookForScore(score.total, input.settings.scoring.thresholds),
    contacts: { phones, emails, decisionMakers: s?.decisionMakerHints ?? [] },
  };
}
