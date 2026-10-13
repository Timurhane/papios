import type { Kurus } from '../money.ts';

/** K-13.8 finance helpers. Dates are local calendar dates (YYYY-MM-DD, Europe/Istanbul). */
export interface SubscriptionTerms {
  monthly_kurus: Kurus;
  discounted_monthly_kurus: Kurus | null;
  discount_months: number;
  started_on: string;
  commitment_months: number;
  day_of_month: number;
  status: 'active' | 'paused' | 'cancelled';
}

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split('-').map(Number);
  return [y ?? 1970, m ?? 1, d ?? 1];
}
const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Adds months, clamping the day to 28 (subscriptions bill on day 1–28). */
export function addMonths(date: string, months: number, day?: number): string {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  return iso(Math.floor(total / 12), (total % 12) + 1, Math.min(day ?? d, 28));
}

/** End of the commitment period: the day before the same date N months later. */
export function contractEnd(startedOn: string, months: number): string {
  const end = new Date(`${addMonths(startedOn, months, parts(startedOn)[2])}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return end.toISOString().slice(0, 10);
}

/** n-th monthly charge (0 = the first, due at start). */
export function periodAmount(s: SubscriptionTerms, n: number): Kurus {
  return s.discounted_monthly_kurus !== null && n < s.discount_months
    ? s.discounted_monthly_kurus
    : s.monthly_kurus;
}

/** Due date of the n-th charge: the first at start, then on day_of_month of each following month. */
export function periodDueDate(s: SubscriptionTerms, n: number): string {
  return n === 0 ? s.started_on : addMonths(s.started_on, n, s.day_of_month);
}

/** Charges that should exist up to and including `until` (to create missing payment rows). */
export function chargesUntil(
  s: SubscriptionTerms,
  until: string,
  max = 60,
): { n: number; due_on: string; amount_kurus: Kurus }[] {
  if (s.status !== 'active') return [];
  const out: { n: number; due_on: string; amount_kurus: Kurus }[] = [];
  for (let n = 0; n < max; n++) {
    const due = periodDueDate(s, n);
    if (due > until) break;
    out.push({ n, due_on: due, amount_kurus: periodAmount(s, n) });
  }
  return out;
}

/** Monthly recurring revenue: what active subscriptions bill this month (discount counted while it lasts). */
export function mrr(subs: SubscriptionTerms[], today: string): Kurus {
  let total = 0;
  for (const s of subs) {
    if (s.status !== 'active' || s.started_on > today) continue;
    const [ty, tm] = parts(today);
    const [sy, sm] = parts(s.started_on);
    const n = (ty - sy) * 12 + (tm - sm);
    total += periodAmount(s, n);
  }
  return total;
}

export interface PaymentLike {
  id: string;
  status: 'due' | 'paid' | 'cancelled';
  due_on: string;
  overdue_notified_on: string | null;
}

/** Payments past due by more than `graceDays` that have not been reported yet. */
export function overdueToNotify<T extends PaymentLike>(
  payments: T[],
  today: string,
  graceDays: number,
): T[] {
  const limit = new Date(`${today}T12:00:00Z`);
  limit.setUTCDate(limit.getUTCDate() - graceDays);
  const cutoff = limit.toISOString().slice(0, 10);
  return payments.filter((p) => p.status === 'due' && p.due_on < cutoff && !p.overdue_notified_on);
}
