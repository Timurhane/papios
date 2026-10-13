import { ProviderError } from '../errors.ts';
import type { LLMProvider, ProviderGenerateInput, ProviderGenerateOutput } from '../types.ts';
import { ensureOk, safeFetch, type FetchFn } from './http.ts';

const BASE = 'https://api.groq.com/openai/v1';

/** Groq: OpenAI-compatible chat + Whisper transcription. Fallback brain (K-3.7) and STT (K-3.9). */
export class GroqProvider implements LLMProvider {
  readonly id = 'groq' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const messages = [
      ...(input.system ? [{ role: 'system', content: input.system }] : []),
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const res = await safeFetch(this.id, this.fetchFn, `${BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages,
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        ...(input.maxOutputTokens !== undefined
          ? { max_completion_tokens: input.maxOutputTokens }
          : {}),
        ...(input.json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    await ensureOk(this.id, res);
    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content ?? '';
    if (!text) throw new ProviderError(this.id, 200, 'empty response');
    return {
      text,
      usage: {
        tokensIn: data.usage?.prompt_tokens ?? 0,
        tokensOut: data.usage?.completion_tokens ?? 0,
      },
    };
  }

  async transcribe(input: {
    model: string;
    audio: Uint8Array;
    mimeType: string;
    language: string;
  }): Promise<string> {
    const form = new FormData();
    const ext = input.mimeType.includes('ogg')
      ? 'ogg'
      : input.mimeType.includes('mpeg')
        ? 'mp3'
        : 'bin';
    form.append('file', new Blob([input.audio.slice()], { type: input.mimeType }), `audio.${ext}`);
    form.append('model', input.model);
    form.append('language', input.language);
    form.append('response_format', 'json');
    const res = await safeFetch(this.id, this.fetchFn, `${BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.apiKey}` },
      body: form,
    });
    await ensureOk(this.id, res);
    const data = (await res.json()) as { text?: string };
    return (data.text ?? '').trim();
  }

  async listModels(): Promise<string[]> {
    const res = await safeFetch(this.id, this.fetchFn, `${BASE}/models`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
    });
    await ensureOk(this.id, res);
    const data = (await res.json()) as { data?: { id: string }[] };
    return (data.data ?? []).map((m) => m.id);
  }
}
