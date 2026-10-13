import type { z } from 'zod';

export type ProviderId = 'gemini' | 'groq' | 'anthropic';
export type Tier = 'light' | 'medium' | 'heavy';

/**
 * K-4.7 data classification. Free-tier providers may use inputs to improve their products, so only
 * `public` (public business info) and `internal` (drafts, analyses, Timurhan's own instructions)
 * may go to them. `personal` and `client_sensitive` require a paid, no-training provider.
 */
export type DataClass = 'public' | 'internal' | 'personal' | 'client_sensitive';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CallMeta {
  /** Agent name, e.g. papi, kasif, analist. */
  agent: string;
  /** Task name, e.g. papi.turn, analysis.summary. */
  task: string;
  dataClass: DataClass;
  promptId?: string;
  promptVersion?: number;
}

export interface GenerateRequest extends CallMeta {
  tier: Tier;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  /** Skip the cache, e.g. for conversational turns that must not repeat. */
  noCache?: boolean;
}

export interface StructuredRequest<T> extends GenerateRequest {
  schema: z.ZodType<T>;
  /** Short schema description included in the prompt. */
  schemaHint: string;
}

export interface Usage {
  tokensIn: number;
  tokensOut: number;
}

export interface GenerateResult {
  text: string;
  provider: ProviderId | 'cache';
  model: string | null;
  usage: Usage;
  cached: boolean;
}

/** What an adapter receives: a fully routed request. */
export interface ProviderGenerateInput {
  model: string;
  system?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  json: boolean;
}

export interface ProviderGenerateOutput {
  text: string;
  usage: Usage;
}

export interface LLMProvider {
  readonly id: ProviderId;
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput>;
  embed?(input: { model: string; texts: string[]; dimensions: number }): Promise<number[][]>;
  transcribe?(input: {
    model: string;
    audio: Uint8Array;
    mimeType: string;
    language: string;
  }): Promise<string>;
  speak?(input: {
    model: string;
    text: string;
    voice: string | null;
  }): Promise<{ audio: Uint8Array; mimeType: string }>;
  listModels?(): Promise<string[]>;
}

export interface LlmCallRecord {
  agent: string;
  task: string;
  tier: Tier | 'embed' | 'transcribe' | 'speak';
  provider: string | null;
  model: string | null;
  dataClass: DataClass;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  cached: boolean;
  status: 'ok' | 'error' | 'rate_limited' | 'blocked' | 'quota_exhausted';
  error?: string;
  promptId?: string;
  promptVersion?: number;
}

/** Persistence the LLM service needs. Supabase-backed in the Worker, in-memory in tests. */
export interface LLMStore {
  getCache(key: string): Promise<unknown | undefined>;
  setCache(key: string, value: unknown, ttlDays: number): Promise<void>;
  /** Atomically reserve one request in the bucket; false when limits are reached or unset. */
  consumeQuota(
    bucket: string,
    rpm: number | null,
    rpd: number | null,
    dayTimezone: string,
  ): Promise<boolean>;
  logCall(record: LlmCallRecord): Promise<void>;
}
