import { describe, expect, it } from 'vitest';
import {
  addMonths,
  chargesUntil,
  contractEnd,
  mrr,
  overdueToNotify,
  type SubscriptionTerms,
} from './finance.ts';

const sub: SubscriptionTerms = {
  monthly_kurus: 2_167_500,
  discounted_monthly_kurus: 1_734_000,
  discount_months: 3,
  started_on: '2026-10-13',
  commitment_months: 3,
  day_of_month: 13,
  status: 'active',
};

describe('finance (K-13.8)', () => {
  it('adds months and clamps to day 28', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2026-11-15', 2)).toBe('2027-01-15');
  });

  it('contract end is the day before the anniversary', () => {
    expect(contractEnd('2026-10-13', 12)).toBe('2027-10-12');
    expect(contractEnd('2026-10-13', 3)).toBe('2027-01-12');
  });

  it('charges: first at start, then monthly; founder discount for the first months', () => {
    expect(chargesUntil(sub, '2027-02-13')).toEqual([
      { n: 0, due_on: '2026-10-13', amount_kurus: 1_734_000 },
      { n: 1, due_on: '2026-11-13', amount_kurus: 1_734_000 },
      { n: 2, due_on: '2026-12-13', amount_kurus: 1_734_000 },
      { n: 3, due_on: '2027-01-13', amount_kurus: 2_167_500 },
      { n: 4, due_on: '2027-02-13', amount_kurus: 2_167_500 },
    ]);
    expect(chargesUntil({ ...sub, status: 'cancelled' }, '2027-02-13')).toEqual([]);
  });

  it('MRR counts the discount while it lasts and ignores future/cancelled subscriptions', () => {
    const other = {
      ...sub,
      discounted_monthly_kurus: null,
      monthly_kurus: 1_487_500,
      started_on: '2026-12-01',
    };
    expect(mrr([sub, other], '2026-11-20')).toBe(1_734_000);
    expect(mrr([sub, other], '2027-01-20')).toBe(2_167_500 + 1_487_500);
    expect(mrr([{ ...sub, status: 'cancelled' }], '2027-01-20')).toBe(0);
  });

  it('overdue payments are reported once after the grace period', () => {
    const ps = [
      { id: 'a', status: 'due' as const, due_on: '2026-10-01', overdue_notified_on: null },
      { id: 'b', status: 'due' as const, due_on: '2026-10-12', overdue_notified_on: null },
      { id: 'c', status: 'due' as const, due_on: '2026-10-01', overdue_notified_on: '2026-10-05' },
      { id: 'd', status: 'paid' as const, due_on: '2026-10-01', overdue_notified_on: null },
    ];
    expect(overdueToNotify(ps, '2026-10-13', 3).map((p) => p.id)).toEqual(['a']);
  });
});
