import { defaultSettings, dispatch, LLMService, type LLMProvider } from '@papi/core';
import { MemoryRepo, type SendOptions, type TelegramApi } from '@papi/server';
import { describe, expect, it } from 'vitest';
import { buildHeavyRegistry, type HeavyDeps } from './handlers.ts';

class Tg implements TelegramApi {
  texts: string[] = [];
  async sendMessage(_c: number, text: string, _o?: SendOptions) {
    this.texts.push(text);
    return { message_id: 1 };
  }
  async editReplyMarkup() {}
  async answerCallback() {}
  async downloadFile() {
    return { bytes: new Uint8Array(), mimeType: 'audio/ogg' };
  }
  async sendAudio() {}
  async sendChatAction() {}
}

const summaryLLM = (repo: MemoryRepo) => {
  const gemini: LLMProvider = {
    id: 'gemini',
    supportsGrounding: true,
    async generate(input) {
      if (input.grounding)
        return { text: 'Yılmaz Emlak | yilmazemlak.com', usage: { tokensIn: 1, tokensOut: 1 } };
      const ids = (JSON.parse(input.messages[0]?.content ?? '[]') as { id: string }[]).map(
        (x) => x.id,
      );
      return {
        text: JSON.stringify({
          results: ids.map((id) => ({
            id,
            sector: 'Emlak',
            city: 'Balıkesir',
            findings: ['Birinci bulgu cümlesi.', 'İkinci bulgu cümlesi.', 'Üçüncü bulgu cümlesi.'],
            strongest_finding: 'En güçlü bulgu cümlesi burada.',
          })),
        }),
        usage: { tokensIn: 1, tokensOut: 1 },
      };
    },
  };
  return new LLMService({
    providers: { gemini },
    settings: defaultSettings.llm,
    store: repo.llmStore,
  });
};

const fetchFn = (async (input: string | URL) => {
  const url = String(input);
  if (url.includes('pagespeedonline'))
    return new Response(
      JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.5 } } } }),
    );
  if (url.startsWith('https://overpass-api.de'))
    return new Response(
      JSON.stringify({ elements: [{ tags: { name: 'Kıyı Otel', website: 'kiyiotel.com' } }] }),
    );
  if (url.startsWith('https://yilmazemlak.com') || url.startsWith('https://kiyiotel.com')) {
    const host = new URL(url).hostname;
    const res = new Response(
      `<title>${host === 'kiyiotel.com' ? 'Kıyı Otel' : 'Yılmaz Emlak'}</title><p>Balıkesir</p>`,
      { headers: { 'content-type': 'text/html' } },
    );
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }
  throw new Error(`offline ${url}`);
}) as unknown as typeof fetch;

function setup(render: HeavyDeps['render'] = null, extra: Partial<HeavyDeps> = {}) {
  const repo = new MemoryRepo();
  const tg = new Tg();
  const deps: HeavyDeps = {
    repo,
    llm: summaryLLM(repo),
    tg,
    ownerChatId: 1,
    render,
    fetchFn,
    sleep: async () => undefined,
    ...extra,
  };
  const run = () =>
    dispatch({
      store: repo.queueStore,
      registry: buildHeavyRegistry(deps),
      worker: 't',
      heavy: true,
      limit: 10,
    });
  return { repo, tg, run };
}

describe('heavy jobs (Actions worker)', () => {
  it('CSV import creates companies and queues their analysis, which then runs', async () => {
    const { repo, tg, run } = setup();
    await repo.enqueue(
      'kasif.csv_import',
      {
        rows: [
          { name: 'Yılmaz Emlak', website: 'yilmazemlak.com' },
          { name: 'Yılmaz Emlak', website: 'https://yilmazemlak.com' },
        ],
      },
      { heavy: true },
    );
    await run();
    expect(repo.companies).toHaveLength(1);
    expect(tg.texts[0]).toContain('1 yeni firma, 1 zaten kayıtlı');
    await run();
    expect(repo.companies[0]).toMatchObject({ stage: expect.stringMatching(/analyzed|waitlist/) });
    expect(tg.texts.at(-1)).toContain('1 firma analiz edildi');
  });

  it('OSM and grounded searches import verified companies', async () => {
    const { repo, run } = setup();
    await repo.enqueue(
      'kasif.osm_search',
      { area: 'Balıkesir', sectors: ['hotel'] },
      { heavy: true },
    );
    await repo.enqueue(
      'kasif.grounded_search',
      { query: "Balıkesir'deki emlakçılar" },
      { heavy: true },
    );
    await run();
    expect(repo.companies.map((c) => c.name).sort()).toEqual(['Kıyı Otel', 'Yılmaz Emlak']);
  });

  it('deep crawl uses the browser renderer', async () => {
    let rendered = '';
    const { repo, tg, run } = setup(async (url) => {
      rendered = url;
      return (await import('@papi/core')).fetchSite('https://yilmazemlak.com/', fetchFn);
    });
    const id = await repo.createCompany({
      name: 'JS Site',
      name_norm: 'js site',
      source: 'telegram',
      domain: 'jssite.com',
      website_url: 'https://jssite.com/',
    });
    await repo.enqueue('analysis.deep_crawl', { companyId: id }, { heavy: true });
    await run();
    expect(rendered).toBe('https://jssite.com/');
    expect(repo.analyses[0]).toMatchObject({ kind: 'deep', status: 'ok' });
    expect(tg.texts[0]).toContain('/100');
  });

  it('a site even a browser cannot open is scored as "no website" so it keeps a next step', async () => {
    const { repo, run } = setup(async () => null);
    const id = await repo.createCompany({
      name: 'Ölü Site',
      name_norm: 'olu site',
      source: 'telegram',
      domain: 'olu.com',
      website_url: 'https://olu.com/',
    });
    await repo.enqueue('analysis.deep_crawl', { companyId: id }, { heavy: true });
    await run();
    const c = await repo.getCompany(id);
    expect(c?.score).not.toBeNull();
    expect(['playbook', 'waiting']).toContain(c?.next_step_kind);
    expect(c?.score_rationale.join(' ')).toContain('Web sitesi yok');
  });
});

describe('Phase 6 signals and geocoding', () => {
  const company = {
    name: 'Yılmaz Emlak',
    name_norm: 'yilmaz emlak',
    source: 'manual' as const,
    domain: 'yilmazemlak.com',
    website_url: 'https://yilmazemlak.com/',
  };

  it('site rescan turns a change since last week into a signal and moves an idle lead', async () => {
    const { repo, tg, run } = setup();
    const id = await repo.createCompany(company);
    await repo.updateCompany(id, { score: 80, stage: 'waitlist' });
    await repo.saveSiteSnapshot(id, {
      booking: true,
      whatsapp: false,
      onlineOrder: false,
      chat: false,
      contactForm: false,
      branches: false,
      careers: false,
      campaign: false,
    });
    await repo.enqueue('signals.site_scan', { limit: 10 }, { heavy: true });
    await run();
    expect(tg.texts[0]).toContain('Yılmaz Emlak: Siteden online randevu kaldırıldı');
    expect(await repo.getCompany(id)).toMatchObject({ assigned_playbook: 'sinyal' });
    expect(repo.jobs.map((j) => j.type)).toContain('analysis.batch');
  });

  it('grounded news for top companies becomes signals', async () => {
    const gemini: LLMProvider = {
      id: 'gemini',
      supportsGrounding: true,
      async generate() {
        return {
          text: JSON.stringify({
            items: [{ kind: 'new_opening', description: 'İkinci şubesini açtı', url: null }],
          }),
          usage: { tokensIn: 1, tokensOut: 1 },
        };
      },
    };
    const repo0 = new MemoryRepo();
    const llm = new LLMService({
      providers: { gemini },
      settings: defaultSettings.llm,
      store: repo0.llmStore,
    });
    const { repo, tg, run } = setup(null, { llm });
    const id = await repo.createCompany(company);
    await repo.updateCompany(id, { score: 90, stage: 'analyzed' });
    await repo.enqueue('signals.news', { limit: 5 }, { heavy: true });
    await run();
    expect(tg.texts[0]).toContain('Yılmaz Emlak: İkinci şubesini açtı');
  });

  it('OSM: a place that appears after an area was first covered is a new opening', async () => {
    let places = [{ tags: { name: 'Kıyı Otel', website: 'kiyiotel.com' } }];
    const osmFetch = (async (input: string | URL, init?: RequestInit) =>
      String(input).startsWith('https://overpass-api.de')
        ? new Response(JSON.stringify({ elements: places }))
        : fetchFn(input, init)) as typeof fetch;
    const { repo, tg, run } = setup(null, { fetchFn: osmFetch });
    await repo.enqueue('signals.osm_new', {}, { heavy: true });
    await run();
    expect(tg.texts.some((t) => t.includes('Yeni açılan'))).toBe(false);

    places = [...places, { tags: { name: 'Yeni Klinik', website: 'yilmazemlak.com' } }];
    await repo.enqueue('signals.osm_new', {}, { heavy: true });
    await run();
    expect(tg.texts.find((t) => t.includes('Yeni açılan'))).toContain('Yeni Klinik (Balıkesir)');
  });

  it('geocodes addresses through Nominatim once and caches the answer', async () => {
    const urls: string[] = [];
    const geoFetch = (async (input: string | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify([{ lat: '39.65', lon: '27.88' }]));
    }) as typeof fetch;
    const { repo, run } = setup(null, { fetchFn: geoFetch });
    for (const n of ['A', 'B']) {
      const id = await repo.createCompany({
        name: n,
        name_norm: n.toLowerCase(),
        source: 'manual',
      });
      await repo.updateCompany(id, { address: 'Anafartalar Cd. 1', city: 'Balıkesir' });
    }
    await repo.enqueue('geo.geocode', {}, { heavy: true });
    await run();
    expect(urls).toHaveLength(1); // same address → cache
    expect(urls[0]).toContain('nominatim.openstreetmap.org');
    expect([...repo.locations.values()]).toEqual([
      { lat: 39.65, lng: 27.88 },
      { lat: 39.65, lng: 27.88 },
    ]);
  });
});
