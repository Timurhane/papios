import { describe, expect, it } from 'vitest';
import { ProviderError, RateLimitedError } from '../errors.ts';
import { AnthropicProvider } from './anthropic.ts';
import { GeminiProvider, pcmToWav } from './gemini.ts';
import { GroqProvider } from './groq.ts';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const input = {
  model: 'gemini-flash-latest',
  system: "Sen Papi'sin.",
  messages: [
    { role: 'user' as const, content: 'Selam' },
    { role: 'assistant' as const, content: 'Merhaba' },
    { role: 'user' as const, content: 'Nasılsın?' },
  ],
  json: true,
};

describe('GeminiProvider', () => {
  it('sends the key in a header, maps roles and requests JSON', async () => {
    const f = fakeFetch(200, {
      candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }],
      usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 3 },
    });
    const out = await new GeminiProvider('KEY', f.fn).generate(input);
    expect(out).toEqual({ text: '{"ok":true}', usage: { tokensIn: 12, tokensOut: 3 } });
    const call = f.calls[0]!;
    expect(call.url).toContain('/models/gemini-flash-latest:generateContent');
    expect(call.url).not.toContain('KEY');
    expect((call.init.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(call.init.body as string);
    expect(body.contents.map((c: { role: string }) => c.role)).toEqual(['user', 'model', 'user']);
    expect(body.systemInstruction.parts[0].text).toBe("Sen Papi'sin.");
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('maps 429 to RateLimitedError and 5xx to ProviderError', async () => {
    await expect(
      new GeminiProvider('K', fakeFetch(429, 'quota').fn).generate(input),
    ).rejects.toBeInstanceOf(RateLimitedError);
    await expect(
      new GeminiProvider('K', fakeFetch(503, 'down').fn).generate(input),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it('treats a blocked/empty answer as a provider error', async () => {
    const f = fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    await expect(new GeminiProvider('K', f.fn).generate(input)).rejects.toThrow(/SAFETY/);
  });

  it('batch-embeds with the requested dimensions and normalizes vectors', async () => {
    const f = fakeFetch(200, { embeddings: [{ values: [3, 4] }] });
    const out = await new GeminiProvider('K', f.fn).embed({
      model: 'gemini-embedding-001',
      texts: ['x'],
      dimensions: 768,
    });
    expect(out[0]![0]).toBeCloseTo(0.6);
    expect(JSON.parse(f.calls[0]!.init.body as string).requests[0].outputDimensionality).toBe(768);
  });

  it('wraps PCM speech into WAV', () => {
    const wav = pcmToWav(new Uint8Array([0, 0, 1, 0]), 24000);
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF');
    expect(wav.length).toBe(48);
  });
});

describe('GroqProvider', () => {
  it('uses the OpenAI-compatible chat API with a system message and JSON mode', async () => {
    const f = fakeFetch(200, {
      choices: [{ message: { content: 'tamam' } }],
      usage: { prompt_tokens: 5, completion_tokens: 1 },
    });
    const out = await new GroqProvider('GK', f.fn).generate({
      ...input,
      model: 'openai/gpt-oss-20b',
    });
    expect(out.text).toBe('tamam');
    const body = JSON.parse(f.calls[0]!.init.body as string);
    expect(body.messages[0]).toEqual({ role: 'system', content: "Sen Papi'sin." });
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect((f.calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer GK');
  });

  it('transcribes audio as multipart form data', async () => {
    const f = fakeFetch(200, { text: ' merhaba ' });
    const text = await new GroqProvider('GK', f.fn).transcribe({
      model: 'whisper-large-v3-turbo',
      audio: new Uint8Array([1, 2]),
      mimeType: 'audio/ogg',
      language: 'tr',
    });
    expect(text).toBe('merhaba');
    const form = f.calls[0]!.init.body as FormData;
    expect(form.get('model')).toBe('whisper-large-v3-turbo');
    expect(form.get('language')).toBe('tr');
  });
});

describe('AnthropicProvider', () => {
  it('calls the Messages API with version header', async () => {
    const f = fakeFetch(200, {
      content: [{ type: 'text', text: 'Merhaba' }],
      usage: { input_tokens: 4, output_tokens: 2 },
    });
    const out = await new AnthropicProvider('AK', f.fn).generate({
      ...input,
      model: 'claude-x',
      json: false,
    });
    expect(out.text).toBe('Merhaba');
    const headers = f.calls[0]!.init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(JSON.parse(f.calls[0]!.init.body as string).system).toBe("Sen Papi'sin.");
  });
});

describe('Gemini grounding', () => {
  it('adds the google_search tool and returns sources', async () => {
    const f = fakeFetch(200, {
      candidates: [
        {
          content: { parts: [{ text: 'x' }] },
          groundingMetadata: {
            groundingChunks: [{ web: { uri: 'https://a.com', title: 'A' } }, {}],
          },
        },
      ],
    });
    const out = await new GeminiProvider('K', f.fn).generate({
      ...input,
      json: false,
      grounding: true,
    });
    expect(JSON.parse(f.calls[0]!.init.body as string).tools).toEqual([{ google_search: {} }]);
    expect(out.sources).toEqual([{ uri: 'https://a.com', title: 'A' }]);
  });
});
