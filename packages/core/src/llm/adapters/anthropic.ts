import { ProviderError, RateLimitedError } from '../errors.ts';
import type { LLMProvider, ProviderGenerateInput, ProviderGenerateOutput } from '../types.ts';
import { ensureOk, safeFetch, type FetchFn } from './http.ts';

/**
 * Anthropic Claude adapter (K-4.2): ready but off. Enable with the `adapter_anthropic` feature flag,
 * the ANTHROPIC_API_KEY secret, a paid quota bucket and routing in settings (see docs/switch-to-claude.md).
 */
export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic' as const;

  constructor(
    private readonly apiKey: string,
    private readonly fetchFn: FetchFn = fetch,
  ) {}

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const res = await safeFetch(this.id, this.fetchFn, 'https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxOutputTokens ?? 2048,
        ...(input.system ? { system: input.system } : {}),
        ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
        messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (res.status === 529) throw new RateLimitedError(this.id, 'overloaded');
    await ensureOk(this.id, res);
    const data = (await res.json()) as {
      content?: { type: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
    };
    const text = (data.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('');
    if (!text) throw new ProviderError(this.id, 200, 'empty response');
    return {
      text,
      usage: { tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0 },
    };
  }
}
