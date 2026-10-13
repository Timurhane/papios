import { ProviderError, RateLimitedError } from '../errors.ts';

export type FetchFn = typeof fetch;

/** Maps HTTP failures to fallback-friendly errors without leaking request bodies or keys. */
export async function ensureOk(provider: string, res: Response): Promise<void> {
  if (res.ok) return;
  let detail = '';
  try {
    detail = (await res.text()).slice(0, 300);
  } catch {
    // ignore
  }
  if (res.status === 429) throw new RateLimitedError(provider, detail || 'HTTP 429');
  throw new ProviderError(provider, res.status, `HTTP ${res.status} ${detail}`.trim());
}

export async function safeFetch(
  provider: string,
  fetchFn: FetchFn,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchFn(url, init);
  } catch (err) {
    throw new ProviderError(provider, null, err instanceof Error ? err.message : 'network error');
  }
}
