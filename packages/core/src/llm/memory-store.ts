import type { LLMStore, LlmCallRecord } from './types.ts';

/** In-memory LLMStore for tests and local scripts. */
export class MemoryLLMStore implements LLMStore {
  readonly cache = new Map<string, unknown>();
  readonly calls: LlmCallRecord[] = [];
  readonly used = new Map<string, number>();

  async getCache(key: string) {
    return this.cache.get(key);
  }
  async setCache(key: string, value: unknown) {
    this.cache.set(key, value);
  }
  async consumeQuota(bucket: string, rpm: number | null, rpd: number | null) {
    if (rpm === null || rpd === null) return false;
    const n = this.used.get(bucket) ?? 0;
    if (n >= Math.min(rpm, rpd)) return false;
    this.used.set(bucket, n + 1);
    return true;
  }
  async logCall(record: LlmCallRecord) {
    this.calls.push(record);
  }
}
