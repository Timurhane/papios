import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { defaultSettings } from '../settings/defaults.ts';
import {
  DataClassBlockedError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitedError,
  StructuredOutputError,
} from './errors.ts';
import { MemoryLLMStore } from './memory-store.ts';
import { LLMService } from './service.ts';
import type { GenerateRequest, LLMProvider, ProviderGenerateInput } from './types.ts';

function fakeProvider(id: LLMProvider['id'], reply: (i: ProviderGenerateInput) => string | Error) {
  const calls: ProviderGenerateInput[] = [];
  const provider: LLMProvider = {
    id,
    async generate(input) {
      calls.push(input);
      const r = reply(input);
      if (r instanceof Error) throw r;
      return { text: r, usage: { tokensIn: 10, tokensOut: 5 } };
    },
    async embed({ texts }) {
      return texts.map((t) => [t.length, 1]);
    },
    async transcribe() {
      return 'merhaba papi';
    },
  };
  return { provider, calls };
}

const req: GenerateRequest = {
  agent: 'papi',
  task: 'test',
  tier: 'light',
  dataClass: 'internal',
  messages: [{ role: 'user', content: 'Selam' }],
};

function setup(
  opts: {
    gemini?: (i: ProviderGenerateInput) => string | Error;
    groq?: (i: ProviderGenerateInput) => string | Error;
    settings?: typeof defaultSettings.llm;
    anthropicEnabled?: boolean;
  } = {},
) {
  const gemini = fakeProvider('gemini', opts.gemini ?? (() => 'gemini cevabı'));
  const groq = fakeProvider('groq', opts.groq ?? (() => 'groq cevabı'));
  const anthropic = fakeProvider('anthropic', () => 'claude cevabı');
  const store = new MemoryLLMStore();
  const service = new LLMService({
    providers: { gemini: gemini.provider, groq: groq.provider, anthropic: anthropic.provider },
    settings: opts.settings ?? defaultSettings.llm,
    store,
    anthropicEnabled: opts.anthropicEnabled,
  });
  return { service, store, gemini, groq, anthropic };
}

describe('LLMService routing', () => {
  it('routes a tier to its configured primary model', async () => {
    const { service, gemini } = setup();
    const out = await service.generate(req);
    expect(out).toMatchObject({
      text: 'gemini cevabı',
      provider: 'gemini',
      model: 'gemini-flash-lite-latest',
    });
    expect(gemini.calls[0]?.model).toBe('gemini-flash-lite-latest');
  });

  it('falls back to Groq when Gemini answers 429 (Phase 1 acceptance)', async () => {
    const { service, store, groq } = setup({ gemini: () => new RateLimitedError('gemini') });
    const out = await service.generate(req);
    expect(out.provider).toBe('groq');
    expect(groq.calls[0]?.model).toBe('openai/gpt-oss-20b');
    expect(store.calls.map((c) => `${c.provider}:${c.status}`)).toEqual([
      'gemini:rate_limited',
      'groq:ok',
    ]);
  });

  it('falls back without calling Gemini when its own quota is used up', async () => {
    const settings = structuredClone(defaultSettings.llm);
    settings.quotas.gemini = { ...settings.quotas.gemini!, rpm: 1, rpd: 1 };
    const { service, gemini, groq } = setup({ settings });
    await service.generate({ ...req, noCache: true });
    const second = await service.generate({ ...req, noCache: true });
    expect(second.provider).toBe('groq');
    expect(gemini.calls).toHaveLength(1);
    expect(groq.calls).toHaveLength(1);
  });

  it('falls back on provider errors (5xx, network)', async () => {
    const { service } = setup({ gemini: () => new ProviderError('gemini', 503, 'unavailable') });
    expect((await service.generate(req)).provider).toBe('groq');
  });

  it('throws QuotaExhaustedError when every provider is limited', async () => {
    const { service } = setup({
      gemini: () => new RateLimitedError('gemini'),
      groq: () => new RateLimitedError('groq'),
    });
    await expect(service.generate(req)).rejects.toBeInstanceOf(QuotaExhaustedError);
  });

  it('never sends personal data to free-tier providers (K-4.7)', async () => {
    const { service, gemini, groq, store } = setup();
    await expect(service.generate({ ...req, dataClass: 'personal' })).rejects.toBeInstanceOf(
      DataClassBlockedError,
    );
    await expect(
      service.generate({ ...req, dataClass: 'client_sensitive' }),
    ).rejects.toBeInstanceOf(DataClassBlockedError);
    expect(gemini.calls).toHaveLength(0);
    expect(groq.calls).toHaveLength(0);
    expect(store.calls.every((c) => c.status === 'blocked')).toBe(true);
  });

  it('keeps Anthropic off unless the feature flag is on (K-4.2)', async () => {
    const settings = structuredClone(defaultSettings.llm);
    settings.routing.light = {
      provider: 'anthropic',
      model: 'claude-x',
      fallback: { provider: 'gemini', model: 'gemini-flash-lite-latest' },
    };
    settings.quotas.anthropic = {
      enabled: true,
      rpm: 10,
      rpd: 10,
      day_timezone: 'UTC',
      free_tier: false,
    };
    const off = setup({ settings });
    expect((await off.service.generate(req)).provider).toBe('gemini');
    const on = setup({ settings, anthropicEnabled: true });
    expect((await on.service.generate(req)).provider).toBe('anthropic');
  });

  it('a paid provider may receive personal data', async () => {
    const settings = structuredClone(defaultSettings.llm);
    settings.routing.light = { provider: 'anthropic', model: 'claude-x', fallback: null };
    settings.quotas.anthropic = {
      enabled: true,
      rpm: 10,
      rpd: 10,
      day_timezone: 'UTC',
      free_tier: false,
    };
    const { service } = setup({ settings, anthropicEnabled: true });
    expect((await service.generate({ ...req, dataClass: 'personal' })).provider).toBe('anthropic');
  });
});

describe('LLMService cache and logging', () => {
  it('serves identical requests from cache without calling the model (K-4.5)', async () => {
    const { service, gemini, store } = setup();
    await service.generate(req);
    const again = await service.generate({ ...req, task: 'different-task-same-input' });
    expect(again).toMatchObject({ cached: true, text: 'gemini cevabı' });
    expect(gemini.calls).toHaveLength(1);
    expect(store.calls.at(-1)).toMatchObject({ provider: 'cache', cached: true });
  });

  it('noCache bypasses the cache', async () => {
    const { service, gemini } = setup();
    await service.generate({ ...req, noCache: true });
    await service.generate({ ...req, noCache: true });
    expect(gemini.calls).toHaveLength(2);
  });

  it('logs agent, task, tokens and data class for every call (K-4.8)', async () => {
    const { service, store } = setup();
    await service.generate({ ...req, promptId: 'papi.system', promptVersion: 2 });
    expect(store.calls[0]).toMatchObject({
      agent: 'papi',
      task: 'test',
      tier: 'light',
      provider: 'gemini',
      dataClass: 'internal',
      tokensIn: 10,
      tokensOut: 5,
      status: 'ok',
      promptId: 'papi.system',
      promptVersion: 2,
    });
  });
});

describe('generateStructured', () => {
  const schema = z.object({ score: z.number().int().min(0).max(100) });

  it('parses JSON (also inside code fences) and validates it', async () => {
    const { service, gemini } = setup({ gemini: () => '```json\n{"score": 72}\n```' });
    const { data } = await service.generateStructured({
      ...req,
      schema,
      schemaHint: '{"score": number}',
    });
    expect(data).toEqual({ score: 72 });
    expect(gemini.calls[0]?.json).toBe(true);
    expect(gemini.calls[0]?.system).toContain('{"score": number}');
  });

  it('retries once when the output does not match the schema', async () => {
    let n = 0;
    const { service } = setup({ gemini: () => (n++ === 0 ? '{"score": 500}' : '{"score": 50}') });
    const { data } = await service.generateStructured({
      ...req,
      schema,
      schemaHint: '{"score": number}',
    });
    expect(data.score).toBe(50);
  });

  it('gives up after the retry', async () => {
    const { service } = setup({ gemini: () => 'bilmiyorum' });
    await expect(
      service.generateStructured({ ...req, schema, schemaHint: '{"score": number}' }),
    ).rejects.toBeInstanceOf(StructuredOutputError);
  });

  it('caches validated structured results', async () => {
    const { service, gemini } = setup({ gemini: () => '{"score": 10}' });
    await service.generateStructured({ ...req, schema, schemaHint: 'x' });
    const again = await service.generateStructured({ ...req, schema, schemaHint: 'x' });
    expect(again.data.score).toBe(10);
    expect(gemini.calls).toHaveLength(1);
  });
});

describe('embed / transcribe / speak', () => {
  it('embeds only uncached texts', async () => {
    const { service, gemini } = setup();
    const spy = vi.spyOn(gemini.provider, 'embed');
    await service.embed(['a', 'bb'], { agent: 'papi', task: 'kb', dataClass: 'internal' });
    const out = await service.embed(['bb', 'ccc'], {
      agent: 'papi',
      task: 'kb',
      dataClass: 'internal',
    });
    expect(out).toEqual([
      [2, 1],
      [3, 1],
    ]);
    expect(spy.mock.calls[1]?.[0].texts).toEqual(['ccc']);
  });

  it('transcribes with Groq Whisper settings', async () => {
    const { service, groq } = setup();
    const spy = vi.spyOn(groq.provider, 'transcribe');
    const text = await service.transcribe(new Uint8Array([1]), 'audio/ogg', {
      agent: 'papi',
      task: 'voice',
      dataClass: 'internal',
    });
    expect(text).toBe('merhaba papi');
    expect(spy.mock.calls[0]?.[0]).toMatchObject({
      model: 'whisper-large-v3-turbo',
      language: 'tr',
    });
  });

  it('speech is off until a model is configured', async () => {
    const { service } = setup();
    expect(
      await service.speak('merhaba', { agent: 'papi', task: 'tts', dataClass: 'internal' }),
    ).toBeNull();
  });
});

describe('grounding (K-8.1)', () => {
  it('uses only grounding-capable providers, its own bucket, and never the cache', async () => {
    const store = new MemoryLLMStore();
    const seen: ProviderGenerateInput[] = [];
    const gemini: LLMProvider = {
      id: 'gemini',
      supportsGrounding: true,
      async generate(input) {
        seen.push(input);
        return {
          text: 'Örnek Klinik | ornek.com',
          usage: { tokensIn: 1, tokensOut: 1 },
          sources: [{ uri: 'https://ornek.com', title: 'Örnek' }],
        };
      },
    };
    const groq: LLMProvider = {
      id: 'groq',
      async generate() {
        throw new Error('must not be used');
      },
    };
    const service = new LLMService({
      providers: { gemini, groq },
      settings: defaultSettings.llm,
      store,
    });
    const r1 = await service.generate({ ...req, grounding: true });
    await service.generate({ ...req, grounding: true });
    expect(r1.sources).toEqual([{ uri: 'https://ornek.com', title: 'Örnek' }]);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toMatchObject({ grounding: true, json: false });
    expect(store.used.get('gemini_ground')).toBe(2);
  });
});
