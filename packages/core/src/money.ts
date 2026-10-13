/** Money is stored as integer kuruş (1 TL = 100 kuruş). Never use floats for amounts. */
export type Kurus = number;

export function tl(amount: number): Kurus {
  if (!Number.isFinite(amount)) throw new RangeError('amount must be finite');
  return Math.round(amount * 100);
}

export function formatTl(value: Kurus): string {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    maximumFractionDigits: value % 100 === 0 ? 0 : 2,
  }).format(value / 100);
}
