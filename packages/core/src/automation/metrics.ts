/** K-16.2 funnel: contact → reply → positive → meeting → proposal → won, with step ratios. */
export interface FunnelCounts {
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  proposals: number;
  won: number;
}

export interface FunnelStep {
  key: keyof FunnelCounts;
  label: string;
  count: number;
  /** Ratio to the previous step, 0..1 (null for the first step or when the previous step is zero). */
  rate: number | null;
}

const STEPS: [keyof FunnelCounts, string][] = [
  ['contacted', 'Temas'],
  ['replied', 'Cevap'],
  ['positive', 'Olumlu cevap'],
  ['meetings', 'Görüşme'],
  ['proposals', 'Teklif'],
  ['won', 'Kazanım'],
];

export function funnel(c: FunnelCounts): FunnelStep[] {
  return STEPS.map(([key, label], i) => {
    const prev = i > 0 ? c[(STEPS[i - 1] as [keyof FunnelCounts, string])[0]] : 0;
    return { key, label, count: c[key], rate: i === 0 || prev === 0 ? null : c[key] / prev };
  });
}

/** Median of positive numbers (e.g. days from first contact to won), null when empty. */
export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? (v[mid] as number) : ((v[mid - 1] as number) + (v[mid] as number)) / 2;
}

/**
 * K-16.1 first reply time: per company, hours from its first sent touch to its first reply after it;
 * the median over companies that replied (null when none did).
 */
export function firstReplyHours(
  sent: { company_id: string; at: string }[],
  replies: { company_id: string; at: string }[],
): number | null {
  const first = new Map<string, number>();
  for (const s of sent) {
    const t = Date.parse(s.at);
    if (!first.has(s.company_id) || t < (first.get(s.company_id) as number))
      first.set(s.company_id, t);
  }
  const hours = new Map<string, number>();
  for (const r of replies) {
    const start = first.get(r.company_id);
    const t = Date.parse(r.at);
    if (start === undefined || t < start) continue;
    const h = (t - start) / 3_600_000;
    if (!hours.has(r.company_id) || h < (hours.get(r.company_id) as number))
      hours.set(r.company_id, h);
  }
  const m = median([...hours.values()]);
  return m === null ? null : Math.round(m * 10) / 10;
}
