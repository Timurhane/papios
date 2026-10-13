import { describe, expect, it } from 'vitest';
import { formatTl, tl } from './money.ts';

describe('money', () => {
  it('converts TL to integer kuruş', () => {
    expect(tl(17_500)).toBe(1_750_000);
    expect(tl(0.1 + 0.2)).toBe(30);
  });

  it('rejects non-finite amounts', () => {
    expect(() => tl(Number.NaN)).toThrow(RangeError);
  });

  it('formats in Turkish locale', () => {
    expect(formatTl(1_750_000)).toMatch(/17\.500/);
  });
});
