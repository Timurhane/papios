import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaults.ts';
import { MemoryLLMStore } from '../llm/memory-store.ts';
import { LLMService } from '../llm/service.ts';
import type { LLMProvider, ProviderGenerateInput } from '../llm/types.ts';
import { fetchPageSpeed, fetchSite, scoreCompany } from './pipeline.ts';
import { summarizeBatch } from './summary.ts';

const pages: Record<string, { status: number; type: string; body: string }> = {
  'https://ornekdis.com/': {
    status: 200,
    type: 'text/html; charset=utf-8',
    body: '<title>Örnek Diş Kliniği</title><a href="/iletisim">İletişim</a><a href="tel:02661234567">Ara</a><p>© 2020</p>',
  },
  'https://ornekdis.com/iletisim': {
    status: 200,
    type: 'text/html',
    body: '<p>Adres: Karesi/Balıkesir</p><a href="mailto:info@ornekdis.com">mail</a>',
  },
};

const fakeFetch = (async (input: string) => {
  const url = String(input);
  if (url.startsWith('https://www.googleapis.com/pagespeedonline')) {
    return new Response(
      JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.31 } } } }),
      { status: 200 },
    );
  }
  const p = pages[url];
  if (!p) return new Response('nope', { status: 404, headers: { 'content-type': 'text/html' } });
  const res = new Response(p.body, { status: p.status, headers: { 'content-type': p.type } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}) as unknown as typeof fetch;

describe('fetchSite', () => {
  it('fetches home + contact page and merges signals', async () => {
    const site = await fetchSite('https://ornekdis.com/', fakeFetch);
    expect(site?.signals).toMatchObject({
      title: 'Örnek Diş Kliniği',
      emails: ['info@ornekdis.com'],
      phones: ['902661234567'],
    });
  });

  it('returns null for unreachable or non-HTML sites', async () => {
    expect(await fetchSite('https://yok.com/', fakeFetch)).toBeNull();
    const throwing = (async () => {
      throw new Error('dns');
    }) as unknown as typeof fetch;
    expect(await fetchSite('https://yok.com/', throwing)).toBeNull();
  });

  it('reads PageSpeed', async () => {
    expect(
      (await fetchPageSpeed('https://ornekdis.com/', 'mobile', undefined, fakeFetch))?.performance,
    ).toBe(31);
  });
});

describe('summarizeBatch (K-4.6)', () => {
  it('summarizes several companies in one call with public data only', async () => {
    const inputs: ProviderGenerateInput[] = [];
    const gemini: LLMProvider = {
      id: 'gemini',
      async generate(input) {
        inputs.push(input);
        return {
          text: JSON.stringify({
            results: ['a', 'b', 'zzz'].map((id) => ({
              id,
              sector: 'Diş kliniği',
              city: null,
              findings: [
                'Birinci bulgu cümlesi.',
                'İkinci bulgu cümlesi.',
                'Üçüncü bulgu cümlesi.',
              ],
              strongest_finding: 'En güçlü bulgu cümlesi.',
            })),
          }),
          usage: { tokensIn: 1, tokensOut: 1 },
        };
      },
    };
    const store = new MemoryLLMStore();
    const llm = new LLMService({ providers: { gemini }, settings: defaultSettings.llm, store });
    const site = await fetchSite('https://ornekdis.com/', fakeFetch);
    const out = await summarizeBatch(llm, [
      {
        id: 'a',
        name: 'A',
        signals: site?.signals ?? null,
        mobile: null,
        knownSector: null,
        knownCity: null,
      },
      { id: 'b', name: 'B', signals: null, mobile: null, knownSector: null, knownCity: null },
    ]);
    expect([...out.keys()]).toEqual(['a', 'b']);
    expect(inputs).toHaveLength(1);
    expect(store.calls[0]).toMatchObject({
      dataClass: 'public',
      promptId: 'analist.summary',
      agent: 'analist',
    });
  });
});

describe('scoreCompany', () => {
  it('combines signals into a score, city and playbook', async () => {
    const site = await fetchSite('https://ornekdis.com/', fakeFetch);
    const r = scoreCompany({
      name: 'Örnek Diş Kliniği',
      knownSector: null,
      knownCity: null,
      address: null,
      knownPhone: null,
      knownEmail: null,
      instagram: null,
      site: site?.signals ?? null,
      mobile: { strategy: 'mobile', performance: 31, lcpMs: null, tbtMs: null, cls: null },
      summary: null,
      activeSignals: [],
      settings: defaultSettings,
      now: new Date('2026-10-13'),
    });
    expect(r).toMatchObject({ sector: 'Klinik / sağlık', sectorSource: 'rule', city: 'Balıkesir' });
    expect(r.score.total).toBeGreaterThanOrEqual(70);
    expect(r.playbook).toBe('soguk_ana');
    expect(r.score.rationale.join('\n')).toContain('WhatsApp');
  });

  it('a company without a website still gets a score', () => {
    const r = scoreCompany({
      name: 'Yılmaz Emlak',
      knownSector: null,
      knownCity: 'İzmir',
      address: null,
      knownPhone: '905321234567',
      knownEmail: null,
      instagram: null,
      site: null,
      mobile: null,
      summary: null,
      activeSignals: [],
      settings: defaultSettings,
    });
    expect(r.score.rationale.join('\n')).toContain('Web sitesi yok');
    expect(r.score.total).toBeGreaterThan(0);
  });
});
