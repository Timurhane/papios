import {
  defaultSettings,
  LLMService,
  QuotaExhaustedError,
  type LLMProvider,
  type ProviderGenerateInput,
} from '@papi/core';
import { describe, expect, it } from 'vitest';
import { InstagramDiscovery } from '../adapters/instagram.ts';
import { GooglePlaces, PlacesDisabledError } from '../adapters/places.ts';
import { MemoryRepo } from '../repo/memory.ts';
import { analyzeCompanies, formatOutcome } from './analist.ts';
import {
  addFromLink,
  groundedSearch,
  importRows,
  osmElementsToRows,
  overpassQuery,
} from './kasif.ts';

const SITE =
  '<html lang="tr"><title>Örnek Diş Kliniği | Balıkesir</title><a href="/iletisim">İletişim</a><p>© 2019 Uzm. Dr. Ayşe Yılmaz</p></html>';
const CONTACT =
  '<p>Karesi/Balıkesir</p><a href="tel:0266 123 45 67">t</a><a href="mailto:info@ornekdis.com">m</a>';

function web(extra: Record<string, string> = {}) {
  const pages: Record<string, string> = {
    'https://ornekdis.com/': SITE,
    'https://ornekdis.com/iletisim': CONTACT,
    ...extra,
  };
  return (async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('https://www.googleapis.com/pagespeedonline')) {
      return new Response(
        JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.35 } } } }),
      );
    }
    if (url.startsWith('https://overpass-api.de')) {
      expect(String(init?.body)).toContain('estate_agent');
      return new Response(
        JSON.stringify({
          elements: [
            { tags: { name: 'Yılmaz Emlak', website: 'yilmazemlak.com', phone: '0266 111 22 33' } },
            { tags: {} },
          ],
        }),
      );
    }
    const body = pages[url];
    if (!body) throw new Error(`offline: ${url}`);
    const res = new Response(body, { headers: { 'content-type': 'text/html' } });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }) as unknown as typeof fetch;
}

function llmWith(
  reply: (i: ProviderGenerateInput) => string | Error,
  sources?: { uri: string; title: string }[],
) {
  const calls: ProviderGenerateInput[] = [];
  const gemini: LLMProvider = {
    id: 'gemini',
    supportsGrounding: true,
    async generate(input) {
      calls.push(input);
      const r = reply(input);
      if (r instanceof Error) throw r;
      return { text: r, usage: { tokensIn: 1, tokensOut: 1 }, ...(sources ? { sources } : {}) };
    },
  };
  const repo = new MemoryRepo();
  const llm = new LLMService({
    providers: { gemini },
    settings: defaultSettings.llm,
    store: repo.llmStore,
  });
  return { repo, llm, calls };
}

const summaryReply = (i: ProviderGenerateInput) => {
  const ids = (JSON.parse(i.messages[0]?.content ?? '[]') as { id: string }[]).map((x) => x.id);
  return JSON.stringify({
    results: ids.map((id) => ({
      id,
      sector: 'Diş kliniği',
      city: 'Balıkesir',
      findings: [
        'Randevular telefonla tek tek alınıyor olabilir.',
        'WhatsApp olmadığı için sorular gecikebilir.',
        'Mobil site yavaş olduğu için ziyaretçi kaçabilir.',
      ],
      strongest_finding: 'Mobil sitenin yavaşlığı (35/100) randevu taleplerini kaçırıyor olabilir.',
    })),
  });
};

describe('Telegram link → analysed company card (Phase 2 acceptance)', () => {
  it('creates, analyses, scores and assigns a playbook', async () => {
    const { repo, llm, calls } = llmWith(summaryReply);
    const fetchFn = web();
    const added = await addFromLink({ repo, llm, fetchFn }, 'https://ornekdis.com/');
    expect(added).toMatchObject({ status: 'created', name: 'Örnek Diş Kliniği', analyzable: true });
    if (added.status === 'unsupported') throw new Error('unexpected');

    const company = await repo.getCompany(added.companyId);
    const [outcome] = await analyzeCompanies({ repo, llm, fetchFn }, [company!], 'light');
    expect(outcome).toMatchObject({ status: 'ok', playbook: 'soguk_ana' });
    expect(outcome!.score).toBeGreaterThanOrEqual(70);

    const saved = await repo.getCompany(added.companyId);
    expect(saved).toMatchObject({
      stage: 'analyzed',
      next_step_kind: 'playbook',
      assigned_playbook: 'soguk_ana',
      city: 'Balıkesir',
      phone_e164: '902661234567',
      verified: true,
    });
    expect(repo.analyses[0]).toMatchObject({ status: 'ok', kind: 'light' });
    expect(repo.scores).toHaveLength(1);
    expect(repo.contacts[0]).toMatchObject({ full_name: expect.stringContaining('Ayşe Yılmaz') });
    expect(repo.memories[0]?.content).toContain('35/100');
    expect(calls).toHaveLength(1);
    expect(repo.llmStore.calls[0]).toMatchObject({ dataClass: 'public', agent: 'analist' });

    const card = formatOutcome(outcome!, 'https://papi.pages.dev/');
    expect(card).toContain('→ Soğuk Ana');
    expect(card).toContain(`https://papi.pages.dev/crm/${added.companyId}`);
  });

  it('the same link twice does not create a duplicate (K-8.10)', async () => {
    const { repo, llm } = llmWith(summaryReply);
    const a = await addFromLink({ repo, llm, fetchFn: web() }, 'https://ornekdis.com/');
    const b = await addFromLink({ repo, llm, fetchFn: web() }, 'http://www.ornekdis.com');
    expect(b).toMatchObject({ status: 'existing' });
    expect(
      a.status !== 'unsupported' && b.status !== 'unsupported' && a.companyId === b.companyId,
    ).toBe(true);
    expect(repo.companies).toHaveLength(1);
  });

  it('an unreadable site is deferred to a Playwright crawl, never left without a next step', async () => {
    const { repo, llm } = llmWith(summaryReply);
    const id = await repo.createCompany({
      name: 'Kapalı Site',
      name_norm: 'kapali site',
      source: 'telegram',
      domain: 'kapali.com',
      website_url: 'https://kapali.com/',
    });
    const [o] = await analyzeCompanies({ repo, llm, fetchFn: web() }, [
      (await repo.getCompany(id))!,
    ]);
    expect(o).toMatchObject({ needsDeepCrawl: true, status: 'failed' });
    expect(repo.jobs[0]).toMatchObject({ type: 'analysis.deep_crawl', heavy: true });
    expect(await repo.getCompany(id)).toMatchObject({
      next_step_kind: 'waiting',
      waiting_reason: expect.stringContaining('derin tarama'),
    });
  });

  it('quota exhaustion degrades to a rules-only score', async () => {
    const { repo, llm } = llmWith(() => new QuotaExhaustedError(60));
    const id = await repo.createCompany({
      name: 'Örnek',
      name_norm: 'ornek',
      source: 'telegram',
      domain: 'ornekdis.com',
      website_url: 'https://ornekdis.com/',
    });
    const [o] = await analyzeCompanies({ repo, llm, fetchFn: web() }, [
      (await repo.getCompany(id))!,
    ]);
    expect(o).toMatchObject({ status: 'partial' });
    expect(o!.score).not.toBeNull();
    expect(formatOutcome(o!)).toContain('kurallarla puanlandı');
  });

  it('low scores go to the waitlist with a reason and a re-check date', async () => {
    const { repo, llm } = llmWith(summaryReply);
    repo.settings.scoring = {
      ...repo.settings.scoring,
      thresholds: { cold_main: 99, light_cold: 98 },
    };
    const id = await repo.createCompany({
      name: 'Örnek',
      name_norm: 'ornek',
      source: 'telegram',
      domain: 'ornekdis.com',
      website_url: 'https://ornekdis.com/',
    });
    await analyzeCompanies(
      { repo, llm, fetchFn: web(), now: () => new Date('2026-10-13T00:00:00Z') },
      [(await repo.getCompany(id))!],
    );
    expect(await repo.getCompany(id)).toMatchObject({
      stage: 'waitlist',
      next_step_kind: 'waiting',
      waiting_until: '2027-01-11',
    });
  });
});

describe('Kaşif sources', () => {
  it('Instagram without the Meta connection is stored but not analysable', async () => {
    const { repo, llm } = llmWith(summaryReply);
    const r = await addFromLink({ repo, llm }, 'https://www.instagram.com/ornekdis/');
    expect(r).toMatchObject({ status: 'created', name: '@ornekdis', analyzable: false });
  });

  it('Instagram business discovery brings the website', async () => {
    const { repo, llm } = llmWith(summaryReply);
    const igFetch = (async (url: string) => {
      expect(decodeURIComponent(String(url))).toContain('business_discovery.username(ornekdis)');
      return new Response(
        JSON.stringify({
          business_discovery: {
            username: 'ornekdis',
            name: 'Örnek Diş',
            website: 'https://ornekdis.com',
            biography: 'Balıkesir',
          },
        }),
      );
    }) as unknown as typeof fetch;
    const ig = new InstagramDiscovery('123', 'TOKEN', 'v23.0', igFetch);
    const r = await addFromLink({ repo, llm, instagram: ig }, 'https://instagram.com/ornekdis');
    expect(r).toMatchObject({ status: 'created', name: 'Örnek Diş', analyzable: true });
    expect(repo.companies[0]).toMatchObject({
      domain: 'ornekdis.com',
      city: 'Balıkesir',
      instagram_handle: 'ornekdis',
    });
  });

  it('Maps link: name from URL, website found by grounded search and verified', async () => {
    const { repo, llm, calls } = llmWith(() => 'Resmi site: ornekdis.com');
    const r = await addFromLink(
      { repo, llm, fetchFn: web() },
      'https://www.google.com/maps/place/%C3%96rnek+Di%C5%9F+Klini%C4%9Fi/@39.6,27.8,17z',
    );
    expect(r).toMatchObject({ status: 'created', name: 'Örnek Diş Kliniği' });
    expect(repo.companies[0]?.domain).toBe('ornekdis.com');
    expect(calls[0]?.grounding).toBe(true);
  });

  it('short Maps links are refused (no Maps scraping, K-8.9)', async () => {
    const { repo, llm } = llmWith(summaryReply);
    expect(await addFromLink({ repo, llm }, 'https://maps.app.goo.gl/abc')).toMatchObject({
      status: 'unsupported',
    });
  });

  it('CSV rows are imported with duplicates skipped', async () => {
    const { repo } = llmWith(summaryReply);
    const r = await importRows(
      repo,
      [
        { name: 'Örnek Klinik', website: 'ornek.com', phone: '0532 123 45 67', city: 'Balıkesir' },
        { name: 'Örnek Klinik Şubesi', website: 'https://www.ornek.com/' },
        { name: 'Başka', phone: '+90 532 123 45 67' },
        { name: ' ' },
      ],
      'csv',
    );
    expect(r).toEqual({ created: [expect.any(String)], duplicates: 2, invalid: 1 });
  });

  it('OSM: query per sector and rows from elements', () => {
    expect(overpassQuery('Balıkesir', ['real_estate'])).toContain('area["name"="Balıkesir"]');
    expect(
      osmElementsToRows(
        {
          elements: [
            { tags: { name: 'A', 'contact:instagram': 'https://instagram.com/aa/' } },
            { tags: {} },
          ],
        },
        'Balıkesir',
      ),
    ).toEqual([expect.objectContaining({ name: 'A', instagram: 'aa', city: 'Balıkesir' })]);
  });

  it('grounded search only keeps results whose site is verified (K-8.1)', async () => {
    const { repo, llm } = llmWith(
      () => '1. Örnek Diş Kliniği | ornekdis.com\n2. Hayali Klinik | hayali.com\n3. Sitesiz | yok',
    );
    const r = await groundedSearch({ repo, llm, fetchFn: web() }, "Balıkesir'deki diş klinikleri");
    expect(r.created).toHaveLength(1);
    expect(repo.companies[0]).toMatchObject({
      name: 'Örnek Diş Kliniği',
      source: 'grounding',
      city: 'Balıkesir',
    });
  });

  it('Google Places stays off (K-8.8)', async () => {
    await expect(new GooglePlaces(false, 'k').textSearch('x')).rejects.toBeInstanceOf(
      PlacesDisabledError,
    );
  });
});
