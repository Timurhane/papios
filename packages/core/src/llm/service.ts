import type { Settings } from '../settings/schema.ts';
import { isAllowedFor } from './classify.ts';
import {
  DataClassBlockedError,
  LLMNotConfiguredError,
  ProviderError,
  QuotaExhaustedError,
  RateLimitedError,
  StructuredOutputError,
} from './errors.ts';
import { sha256Hex, stableStringify } from './hash.ts';
import type {
  CallMeta,
  GenerateRequest,
  GenerateResult,
  LLMProvider,
  LLMStore,
  LlmCallRecord,
  ProviderId,
  StructuredRequest,
  Tier,
} from './types.ts';

type LlmSettings = Settings['llm'];

export interface LLMServiceOptions {
  providers: Partial<Record<ProviderId, LLMProvider>>;
  settings: LlmSettings;
  store: LLMStore;
  /** Feature flag `adapter_anthropic` (K-4.2: ready but off). */
  anthropicEnabled?: boolean;
  now?: () => number;
}

interface Candidate {
  provider: LLMProvider;
  model: string;
  bucket: string;
}

const RETRY_AFTER_SECONDS = 60;

/**
 * Single entry point for every model call (K-2.4, K-4.*): tier routing, data-class guard,
 * quota reservation, fallback, caching and call logging.
 */
export class LLMService {
  private readonly now: () => number;

  constructor(private readonly opts: LLMServiceOptions) {
    this.now = opts.now ?? Date.now;
  }

  async generate(req: GenerateRequest): Promise<GenerateResult> {
    return this.generateInternal(req, false);
  }

  async generateStructured<T>(
    req: StructuredRequest<T>,
  ): Promise<{ data: T; result: GenerateResult }> {
    const system = [
      req.system,
      `Yalnızca geçerli JSON döndür; açıklama veya kod bloğu ekleme. Beklenen yapı: ${req.schemaHint}`,
    ]
      .filter(Boolean)
      .join('\n\n');

    const cacheKey = req.noCache
      ? null
      : await this.cacheKey('structured', { ...req, system, schema: undefined });
    if (cacheKey) {
      const hit = await this.opts.store.getCache(cacheKey);
      const parsed = hit === undefined ? null : req.schema.safeParse(hit);
      if (parsed?.success) {
        await this.log(req, req.tier, null, null, { status: 'ok', cached: true });
        return {
          data: parsed.data,
          result: {
            text: JSON.stringify(hit),
            provider: 'cache',
            model: null,
            usage: { tokensIn: 0, tokensOut: 0 },
            cached: true,
          },
        };
      }
    }

    let messages = req.messages;
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.generateInternal({ ...req, system, messages, noCache: true }, true);
      const json = extractJson(result.text);
      const parsed = json === undefined ? null : req.schema.safeParse(json);
      if (parsed?.success) {
        if (cacheKey)
          await this.opts.store.setCache(cacheKey, parsed.data, this.opts.settings.cache_ttl_days);
        return { data: parsed.data, result };
      }
      messages = [
        ...messages,
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content: `Önceki cevap beklenen JSON yapısına uymadı (${parsed ? parsed.error.issues[0]?.message : 'geçersiz JSON'}). Yalnızca düzeltilmiş JSON'u döndür.`,
        },
      ];
    }
    throw new StructuredOutputError(`${req.task}: output did not match schema`);
  }

  async embed(texts: string[], meta: CallMeta): Promise<number[][]> {
    const cfg = this.opts.settings.embedding;
    const results: (number[] | undefined)[] = [];
    const keys = await Promise.all(
      texts.map((t) => this.cacheKey('embed', { model: cfg.model, dims: cfg.dimensions, t })),
    );
    for (const [i, key] of keys.entries()) {
      const hit = await this.opts.store.getCache(key);
      results[i] = Array.isArray(hit) ? (hit as number[]) : undefined;
    }
    const missing = results.flatMap((r, i) => (r ? [] : [i]));
    if (missing.length === 0) {
      await this.log(meta, 'embed', null, null, { status: 'ok', cached: true });
      return results as number[][];
    }

    const candidate = await this.reserve(cfg.provider, cfg.model, 'embed', meta, 'embed');
    if (!candidate.provider.embed) throw new LLMNotConfiguredError(`${cfg.provider} cannot embed`);
    const started = this.now();
    try {
      const vectors = await candidate.provider.embed({
        model: candidate.model,
        texts: missing.map((i) => texts[i] ?? ''),
        dimensions: cfg.dimensions,
      });
      for (const [j, i] of missing.entries()) {
        const v = vectors[j];
        if (!v) throw new ProviderError(cfg.provider, null, 'embedding count mismatch');
        results[i] = v;
        await this.opts.store.setCache(keys[i] ?? '', v, this.opts.settings.cache_ttl_days);
      }
      await this.log(meta, 'embed', cfg.provider, candidate.model, {
        status: 'ok',
        durationMs: this.now() - started,
      });
      return results as number[][];
    } catch (err) {
      await this.log(
        meta,
        'embed',
        cfg.provider,
        candidate.model,
        errorStatus(err, this.now() - started),
      );
      throw err;
    }
  }

  async transcribe(audio: Uint8Array, mimeType: string, meta: CallMeta): Promise<string> {
    const cfg = this.opts.settings.transcription;
    const candidate = await this.reserve(cfg.provider, cfg.model, 'transcribe', meta, 'transcribe');
    if (!candidate.provider.transcribe)
      throw new LLMNotConfiguredError(`${cfg.provider} cannot transcribe`);
    const started = this.now();
    try {
      const text = await candidate.provider.transcribe({
        model: candidate.model,
        audio,
        mimeType,
        language: cfg.language,
      });
      await this.log(meta, 'transcribe', cfg.provider, candidate.model, {
        status: 'ok',
        durationMs: this.now() - started,
      });
      return text;
    } catch (err) {
      await this.log(
        meta,
        'transcribe',
        cfg.provider,
        candidate.model,
        errorStatus(err, this.now() - started),
      );
      throw err;
    }
  }

  /** Returns null when speech is not configured (it is optional, K-15.2). */
  async speak(
    text: string,
    meta: CallMeta,
  ): Promise<{ audio: Uint8Array; mimeType: string } | null> {
    const cfg = this.opts.settings.speech;
    if (!cfg.model) return null;
    const candidate = await this.reserve(cfg.provider, cfg.model, 'speak', meta, 'speak');
    if (!candidate.provider.speak) return null;
    const started = this.now();
    try {
      const out = await candidate.provider.speak({
        model: candidate.model,
        text,
        voice: cfg.voice,
      });
      await this.log(meta, 'speak', cfg.provider, candidate.model, {
        status: 'ok',
        durationMs: this.now() - started,
      });
      return out;
    } catch (err) {
      await this.log(
        meta,
        'speak',
        cfg.provider,
        candidate.model,
        errorStatus(err, this.now() - started),
      );
      throw err;
    }
  }

  /** Configured generation models that the provider does not list (for the verify job). */
  async findMissingModels(): Promise<{ provider: ProviderId; model: string }[]> {
    const wanted = new Map<ProviderId, Set<string>>();
    const add = (p: ProviderId, m: string | null) => {
      if (!m) return;
      if (!wanted.has(p)) wanted.set(p, new Set());
      wanted.get(p)?.add(m);
    };
    for (const route of Object.values(this.opts.settings.routing)) {
      add(route.provider, route.model);
      if (route.fallback) add(route.fallback.provider, route.fallback.model);
    }
    add(this.opts.settings.embedding.provider, this.opts.settings.embedding.model);
    add(this.opts.settings.transcription.provider, this.opts.settings.transcription.model);
    add(this.opts.settings.speech.provider, this.opts.settings.speech.model);

    const missing: { provider: ProviderId; model: string }[] = [];
    for (const [providerId, models] of wanted) {
      if (providerId === 'anthropic' && !this.opts.anthropicEnabled) continue;
      const provider = this.opts.providers[providerId];
      if (!provider?.listModels) continue;
      const available = new Set((await provider.listModels()).map(normalizeModelId));
      for (const m of models)
        if (!available.has(normalizeModelId(m))) missing.push({ provider: providerId, model: m });
    }
    return missing;
  }

  // --- internals -------------------------------------------------------------------------------

  private async generateInternal(req: GenerateRequest, json: boolean): Promise<GenerateResult> {
    // Grounded answers reflect the live web; never serve them from cache.
    const cacheKey =
      req.noCache || req.grounding ? null : await this.cacheKey('generate', { ...req, json });
    if (cacheKey) {
      const hit = await this.opts.store.getCache(cacheKey);
      if (typeof hit === 'string') {
        await this.log(req, req.tier, null, null, { status: 'ok', cached: true });
        return {
          text: hit,
          provider: 'cache',
          model: null,
          usage: { tokensIn: 0, tokensOut: 0 },
          cached: true,
        };
      }
    }

    const candidates = this.candidatesFor(req.tier).filter(
      (c) => !req.grounding || c.provider.supportsGrounding,
    );
    if (candidates.length === 0)
      throw new LLMNotConfiguredError(`no model configured for tier ${req.tier}`);

    let blockedByClass = 0;
    let outOfQuota = 0;
    let lastError: unknown;

    for (const c of candidates) {
      const bucket = this.opts.settings.quotas[c.bucket];
      if (!bucket?.enabled) continue;
      if (!isAllowedFor(req.dataClass, bucket.free_tier)) {
        blockedByClass++;
        await this.log(req, req.tier, c.provider.id, c.model, { status: 'blocked' });
        continue;
      }
      if (req.grounding) {
        // Grounded requests are metered separately by the provider (K-8.1).
        const ground = `${c.provider.id}_ground`;
        const g = this.opts.settings.quotas[ground];
        if (
          !g?.enabled ||
          !(await this.opts.store.consumeQuota(ground, g.rpm, g.rpd, g.day_timezone))
        ) {
          outOfQuota++;
          await this.log(req, req.tier, c.provider.id, c.model, { status: 'quota_exhausted' });
          continue;
        }
      }
      if (
        !(await this.opts.store.consumeQuota(c.bucket, bucket.rpm, bucket.rpd, bucket.day_timezone))
      ) {
        outOfQuota++;
        await this.log(req, req.tier, c.provider.id, c.model, { status: 'quota_exhausted' });
        continue;
      }

      const started = this.now();
      try {
        const out = await c.provider.generate({
          model: c.model,
          system: req.system,
          messages: req.messages,
          temperature: req.temperature,
          maxOutputTokens: req.maxOutputTokens,
          json: json && !req.grounding,
          grounding: req.grounding,
        });
        await this.log(req, req.tier, c.provider.id, c.model, {
          status: 'ok',
          durationMs: this.now() - started,
          tokensIn: out.usage.tokensIn,
          tokensOut: out.usage.tokensOut,
        });
        if (cacheKey)
          await this.opts.store.setCache(cacheKey, out.text, this.opts.settings.cache_ttl_days);
        return {
          text: out.text,
          provider: c.provider.id,
          model: c.model,
          usage: out.usage,
          cached: false,
          ...(out.sources ? { sources: out.sources } : {}),
        };
      } catch (err) {
        lastError = err;
        await this.log(
          req,
          req.tier,
          c.provider.id,
          c.model,
          errorStatus(err, this.now() - started),
        );
        if (err instanceof RateLimitedError) {
          outOfQuota++;
          continue;
        }
        if (err instanceof ProviderError) continue;
        throw err;
      }
    }

    if (blockedByClass > 0 && blockedByClass === candidates.length)
      throw new DataClassBlockedError(req.dataClass);
    if (outOfQuota > 0) throw new QuotaExhaustedError(RETRY_AFTER_SECONDS);
    throw lastError ?? new LLMNotConfiguredError(`no enabled provider for tier ${req.tier}`);
  }

  private candidatesFor(tier: Tier): Candidate[] {
    const route = this.opts.settings.routing[tier];
    const refs = [route, route.fallback].filter((r) => r !== null);
    const out: Candidate[] = [];
    for (const ref of refs) {
      const provider = this.opts.providers[ref.provider];
      if (!provider || !ref.model) continue;
      if (ref.provider === 'anthropic' && !this.opts.anthropicEnabled) continue;
      out.push({ provider, model: ref.model, bucket: ref.provider });
    }
    return out;
  }

  private async reserve(
    providerId: ProviderId,
    model: string | null,
    op: 'embed' | 'transcribe' | 'speak',
    meta: CallMeta,
    tier: LlmCallRecord['tier'],
  ): Promise<Candidate> {
    const provider = this.opts.providers[providerId];
    if (!provider || !model) throw new LLMNotConfiguredError(`${op} is not configured`);
    if (providerId === 'anthropic' && !this.opts.anthropicEnabled)
      throw new LLMNotConfiguredError('anthropic is disabled');
    const bucketName = `${providerId}_${op}`;
    const bucket = this.opts.settings.quotas[bucketName];
    if (!bucket?.enabled)
      throw new LLMNotConfiguredError(`quota bucket ${bucketName} is not enabled`);
    if (!isAllowedFor(meta.dataClass, bucket.free_tier)) {
      await this.log(meta, tier, providerId, model, { status: 'blocked' });
      throw new DataClassBlockedError(meta.dataClass);
    }
    if (
      !(await this.opts.store.consumeQuota(bucketName, bucket.rpm, bucket.rpd, bucket.day_timezone))
    ) {
      await this.log(meta, tier, providerId, model, { status: 'quota_exhausted' });
      throw new QuotaExhaustedError(RETRY_AFTER_SECONDS);
    }
    return { provider, model, bucket: bucketName };
  }

  private async cacheKey(op: string, payload: object): Promise<string> {
    const {
      agent: _a,
      task: _t,
      promptId: _p,
      promptVersion: _v,
      noCache: _n,
      ...rest
    } = payload as GenerateRequest;
    return sha256Hex(stableStringify({ op, ...rest }));
  }

  private async log(
    meta: CallMeta,
    tier: LlmCallRecord['tier'],
    provider: string | null,
    model: string | null,
    extra: Partial<LlmCallRecord> & Pick<LlmCallRecord, 'status'>,
  ): Promise<void> {
    await this.opts.store.logCall({
      agent: meta.agent,
      task: meta.task,
      tier,
      provider: extra.cached ? 'cache' : provider,
      model,
      dataClass: meta.dataClass,
      tokensIn: 0,
      tokensOut: 0,
      durationMs: 0,
      cached: false,
      promptId: meta.promptId,
      promptVersion: meta.promptVersion,
      ...extra,
    });
  }
}

function errorStatus(
  err: unknown,
  durationMs: number,
): Partial<LlmCallRecord> & Pick<LlmCallRecord, 'status'> {
  return {
    status: err instanceof RateLimitedError ? 'rate_limited' : 'error',
    error: err instanceof Error ? err.message.slice(0, 500) : String(err),
    durationMs,
  };
}

function normalizeModelId(id: string): string {
  return id.replace(/^models\//, '');
}

/** Parses model output as JSON, tolerating code fences and leading prose. */
export function extractJson(text: string): unknown {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.search(/[[{]/);
    const end = Math.max(trimmed.lastIndexOf('}'), trimmed.lastIndexOf(']'));
    if (start === -1 || end <= start) return undefined;
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      return undefined;
    }
  }
}
