import { ProviderError } from '../errors.ts';
import type { LLMProvider, ProviderGenerateInput, ProviderGenerateOutput } from '../types.ts';
import { ensureOk, safeFetch, type FetchFn } from './http.ts';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}
interface GeminiResponse {
  candidates?: {
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
    groundingMetadata?: { groundingChunks?: { web?: { uri?: string; title?: string } }[] };
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

export class GeminiProvider implements LLMProvider {
  readonly id = 'gemini' as const;
  readonly supportsGrounding = true;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  private headers() {
    return { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey };
  }

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const body = {
      ...(input.system ? { systemInstruction: { parts: [{ text: input.system }] } } : {}),
      contents: input.messages.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      generationConfig: {
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxOutputTokens !== undefined ? { maxOutputTokens: input.maxOutputTokens } : {}),
        ...(input.json ? { responseMimeType: 'application/json' } : {}),
      },
      ...(input.grounding ? { tools: [{ google_search: {} }] } : {}),
    };
    const res = await safeFetch(
      this.id,
      this.fetchFn,
      `${BASE}/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
      },
    );
    await ensureOk(this.id, res);
    const data = (await res.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (!text) {
      const reason =
        data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? 'empty response';
      throw new ProviderError(this.id, 200, `no text (${reason})`);
    }
    const sources = (data.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [])
      .map((c) => c.web)
      .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
      .map((w) => ({ uri: w.uri, title: w.title ?? null }));
    return {
      text,
      usage: {
        tokensIn: data.usageMetadata?.promptTokenCount ?? 0,
        tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0,
      },
      ...(sources.length ? { sources } : {}),
    };
  }

  async embed(input: { model: string; texts: string[]; dimensions: number }): Promise<number[][]> {
    const res = await safeFetch(
      this.id,
      this.fetchFn,
      `${BASE}/models/${encodeURIComponent(input.model)}:batchEmbedContents`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          requests: input.texts.map((text) => ({
            model: `models/${input.model}`,
            content: { parts: [{ text }] },
            outputDimensionality: input.dimensions,
          })),
        }),
      },
    );
    await ensureOk(this.id, res);
    const data = (await res.json()) as { embeddings?: { values: number[] }[] };
    const vectors = (data.embeddings ?? []).map((e) => normalize(e.values));
    if (vectors.length !== input.texts.length)
      throw new ProviderError(this.id, 200, 'embedding count mismatch');
    return vectors;
  }

  async speak(input: { model: string; text: string; voice: string | null }) {
    const res = await safeFetch(
      this.id,
      this.fetchFn,
      `${BASE}/models/${encodeURIComponent(input.model)}:generateContent`,
      {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: input.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            ...(input.voice
              ? {
                  speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: input.voice } },
                  },
                }
              : {}),
          },
        }),
      },
    );
    await ensureOk(this.id, res);
    const data = (await res.json()) as GeminiResponse;
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData;
    if (!inline) throw new ProviderError(this.id, 200, 'no audio');
    const pcm = base64ToBytes(inline.data);
    const rate = Number(/rate=(\d+)/.exec(inline.mimeType)?.[1] ?? 24000);
    return { audio: pcmToWav(pcm, rate), mimeType: 'audio/wav' };
  }

  async listModels(): Promise<string[]> {
    const res = await safeFetch(this.id, this.fetchFn, `${BASE}/models?pageSize=1000`, {
      headers: this.headers(),
    });
    await ensureOk(this.id, res);
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models ?? []).map((m) => m.name);
  }
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return norm > 0 ? v.map((x) => x / norm) : v;
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Wraps 16-bit mono little-endian PCM in a WAV container. */
export function pcmToWav(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const v = new DataView(header);
  const write = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  write(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  write(36, 'data');
  v.setUint32(40, pcm.length, true);
  const out = new Uint8Array(44 + pcm.length);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}
