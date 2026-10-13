/** Provider answered 429 or similar: try the fallback. */
export class RateLimitedError extends Error {
  override readonly name = 'RateLimitedError';
  constructor(
    readonly provider: string,
    message = 'rate limited',
  ) {
    super(`${provider}: ${message}`);
  }
}

/** Provider failed (5xx, network). Try the fallback. */
export class ProviderError extends Error {
  override readonly name = 'ProviderError';
  constructor(
    readonly provider: string,
    readonly status: number | null,
    message: string,
  ) {
    super(`${provider}: ${message}`);
  }
}

/** Every candidate is out of quota. Callers should requeue the work with a delay. */
export class QuotaExhaustedError extends Error {
  override readonly name = 'QuotaExhaustedError';
  constructor(readonly retryAfterSeconds: number) {
    super('all LLM providers are out of quota');
  }
}

/** The data class may not be sent to any configured provider (K-4.7). */
export class DataClassBlockedError extends Error {
  override readonly name = 'DataClassBlockedError';
  constructor(readonly dataClass: string) {
    super(`data class "${dataClass}" may not be sent to a free-tier provider`);
  }
}

/** Model output did not match the requested schema even after a retry. */
export class StructuredOutputError extends Error {
  override readonly name = 'StructuredOutputError';
}

/** No provider/model is configured or enabled for the operation. */
export class LLMNotConfiguredError extends Error {
  override readonly name = 'LLMNotConfiguredError';
}
