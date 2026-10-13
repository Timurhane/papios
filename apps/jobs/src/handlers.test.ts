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

function setup(render: HeavyDeps['render'] = null) {
  const repo = new MemoryRepo();
  const tg = new Tg();
  const deps: HeavyDeps = { repo, llm: summaryLLM(repo), tg, ownerChatId: 1, render, fetchFn };
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
