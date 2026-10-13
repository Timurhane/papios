import type { DataClass } from './types.ts';

const FREE_TIER_ALLOWED: ReadonlySet<DataClass> = new Set(['public', 'internal']);

/** K-4.7: may data of this class be sent to a provider with these terms? */
export function isAllowedFor(dataClass: DataClass, freeTier: boolean): boolean {
  return !freeTier || FREE_TIER_ALLOWED.has(dataClass);
}
