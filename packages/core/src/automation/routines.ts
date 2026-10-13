import { z } from 'zod';
import { localParts, zoned } from '../outreach/schedule.ts';

/**
 * K-13.5 routines. A routine is a schedule + one action from this allowlist + validated parameters;
 * natural-language routines are parsed into exactly this shape and approved before they are saved.
 */
export const routineParams = {
  morning_brief: z.object({}),
  whom_to_call: z.object({ limit: z.number().int().min(1).max(20).default(5) }),
  signal_scan: z.object({
    site_limit: z.number().int().min(1).max(100).default(40),
    news_limit: z.number().int().min(0).max(20).default(20),
  }),
  competitor_scan: z.object({}),
  sector_news: z.object({}),
  payment_check: z.object({}),
  monthly_reports: z.object({}),
  weekly_summary: z.object({}),
  hot_leads_digest: z.object({
    min_score: z.number().int().min(0).max(100).default(70),
    limit: z.number().int().min(1).max(20).default(10),
  }),
  pipeline_digest: z.object({}),
  reminder: z.object({ text: z.string().trim().min(1).max(500) }),
  content_plan: z.object({ per_platform: z.number().int().min(1).max(3).default(2) }),
  learning_review: z.object({}),
} as const;

export type RoutineAction = keyof typeof routineParams;
export const ROUTINE_ACTIONS = Object.keys(routineParams) as RoutineAction[];

export const ACTION_LABEL: Record<RoutineAction, string> = {
  morning_brief: 'Sabah brifingi',
  whom_to_call: 'Bugün kimi aramalıyım',
  signal_scan: 'Sinyal taraması',
  competitor_scan: 'Rakip taraması',
  sector_news: 'Sektör haberlerinden fırsat',
  payment_check: 'Ödeme gecikme kontrolü',
  monthly_reports: 'Aylık müşteri raporları',
  weekly_summary: 'Haftalık patron özeti',
  hot_leads_digest: 'Sıcak adaylar özeti',
  pipeline_digest: 'Satış hattı özeti',
  reminder: 'Hatırlatma',
  content_plan: 'Haftalık içerik planı',
  learning_review: 'Öğrenen sistem önerileri',
};

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('daily'), time: hhmm }),
  z.object({ kind: z.literal('weekdays'), time: hhmm }),
  z.object({
    kind: z.literal('weekly'),
    time: hhmm,
    days: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  }),
  z.object({ kind: z.literal('monthly'), time: hhmm, day: z.number().int().min(1).max(28) }),
]);
export type RoutineSchedule = z.infer<typeof scheduleSchema>;

export const routineSpecSchema = z.object({
  name: z.string().trim().min(2).max(80),
  schedule: scheduleSchema,
  action: z.enum(ROUTINE_ACTIONS as [RoutineAction, ...RoutineAction[]]),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type RoutineSpec = z.infer<typeof routineSpecSchema>;

/** Validates a spec (e.g. from the model) and fills parameter defaults; null when it does not fit. */
export function validateRoutine(raw: unknown): RoutineSpec | null {
  const spec = routineSpecSchema.safeParse(raw);
  if (!spec.success) return null;
  const params = routineParams[spec.data.action].safeParse(spec.data.params);
  return params.success ? { ...spec.data, params: params.data as Record<string, unknown> } : null;
}

const DAY_NAMES = ['', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];

export function describeSchedule(s: RoutineSchedule): string {
  switch (s.kind) {
    case 'daily':
      return `Her gün ${s.time}`;
    case 'weekdays':
      return `Hafta içi her gün ${s.time}`;
    case 'weekly':
      return `Her ${s.days.map((d) => DAY_NAMES[d]).join(', ')} ${s.time}`;
    case 'monthly':
      return `Her ayın ${s.day}. günü ${s.time}`;
  }
}

/** First run strictly after `after`, in local time of `tz`. */
export function nextRun(s: RoutineSchedule, after: Date, tz = 'Europe/Istanbul'): Date {
  const minutes = Number(s.time.slice(0, 2)) * 60 + Number(s.time.slice(3, 5));
  for (let i = 0; i < 400; i++) {
    const p = localParts(new Date(after.getTime() + i * 86_400_000), tz);
    const ok =
      s.kind === 'daily' ||
      (s.kind === 'weekdays' && p.weekday <= 5) ||
      (s.kind === 'weekly' && s.days.includes(p.weekday)) ||
      (s.kind === 'monthly' && p.d === s.day);
    if (!ok) continue;
    const at = zoned(p.y, p.m, p.d, minutes, tz);
    if (at.getTime() > after.getTime()) return at;
  }
  throw new Error('no next run within 400 days');
}
