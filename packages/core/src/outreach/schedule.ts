import type { Settings } from '../settings/schema.ts';

type Hours = Settings['business_hours'];

interface LocalParts {
  y: number;
  m: number;
  d: number;
  weekday: number; // ISO 1..7
  minutes: number; // minutes since local midnight
}

const WEEKDAY: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

function parts(date: Date, timeZone: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const get = (t: string) => f.find((p) => p.type === t)?.value ?? '0';
  return {
    y: Number(get('year')),
    m: Number(get('month')),
    d: Number(get('day')),
    weekday: WEEKDAY[get('weekday')] ?? 1,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** K-10.10: is `date` inside business hours (default weekdays 09:30–18:00, Europe/Istanbul)? */
export function isBusinessTime(date: Date, h: Hours): boolean {
  const p = parts(date, h.timezone);
  return (
    h.days.includes(p.weekday) && p.minutes >= toMinutes(h.start) && p.minutes < toMinutes(h.end)
  );
}

/** Timezone offset (ms) of `timeZone` at `date`. */
function offsetMs(date: Date, timeZone: string): number {
  const p = parts(date, timeZone);
  const asUtc = Date.UTC(p.y, p.m - 1, p.d, Math.floor(p.minutes / 60), p.minutes % 60);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

/** The UTC instant of local wall time y-m-d hh:mm in `timeZone`. */
function zoned(y: number, m: number, d: number, minutes: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(y, m - 1, d, Math.floor(minutes / 60), minutes % 60));
  return new Date(guess.getTime() - offsetMs(guess, timeZone));
}

/** Earliest business-time instant at or after `from` (K-10.10: night approvals go out in business hours). */
export function nextBusinessTime(from: Date, h: Hours): Date {
  if (isBusinessTime(from, h)) return from;
  const start = toMinutes(h.start);
  for (let i = 0; i < 14; i++) {
    const day = new Date(from.getTime() + i * 86_400_000);
    const p = parts(day, h.timezone);
    if (!h.days.includes(p.weekday)) continue;
    const candidate = zoned(p.y, p.m, p.d, start, h.timezone);
    if (candidate.getTime() >= from.getTime()) return candidate;
  }
  throw new Error('no business day within two weeks; check business_hours settings');
}

/** UTC instant of local midnight of the day containing `date`. */
export function startOfLocalDay(date: Date, timeZone: string): Date {
  const p = parts(date, timeZone);
  return zoned(p.y, p.m, p.d, 0, timeZone);
}

/** Local calendar date (YYYY-MM-DD) in the business timezone. */
export function localDate(date: Date, timeZone: string): string {
  const p = parts(date, timeZone);
  return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`;
}

/** Adds whole days to a YYYY-MM-DD date. */
export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * K-10.9 warm-up: start at `daily_limit`, add `increase_by` every `every_days` since the first send,
 * never above `max_daily_limit`.
 */
export function dailyEmailLimit(
  cfg: Settings['email_sending'],
  firstSendDate: string | null,
  today: string,
): number {
  if (!cfg.warmup.enabled || !firstSendDate) return cfg.daily_limit;
  const days = Math.max(
    0,
    Math.round(
      (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${firstSendDate}T00:00:00Z`)) / 86_400_000,
    ),
  );
  const steps = Math.floor(days / cfg.warmup.every_days);
  return Math.min(cfg.warmup.max_daily_limit, cfg.daily_limit + steps * cfg.warmup.increase_by);
}

/** Random gap between sends (K-10.9), in minutes. `rand` is injectable for tests. */
export function sendGapMinutes(
  cfg: Settings['email_sending'],
  rand: () => number = Math.random,
): number {
  return cfg.min_gap_minutes + Math.floor(rand() * (cfg.max_gap_minutes - cfg.min_gap_minutes + 1));
}

export interface BusyRange {
  start: Date;
  end: Date;
}

export interface SlotOptions {
  count: number;
  durationMinutes: number;
  /** Earliest proposal is this many hours after `from`. */
  leadHours: number;
  horizonDays: number;
  /** Local start times to try (HH:MM); rotated per day so proposals vary. */
  preferredTimes: string[];
}

/**
 * Meeting proposals (Satıcı): at most one per business day, inside business hours, clear of busy ranges
 * (Google Calendar free/busy when connected, otherwise none).
 */
export function meetingSlots(from: Date, h: Hours, busy: BusyRange[], o: SlotOptions): Date[] {
  const earliest = from.getTime() + o.leadHours * 3_600_000;
  const end = toMinutes(h.end);
  const out: Date[] = [];
  for (let i = 0; i <= o.horizonDays && out.length < o.count; i++) {
    const p = parts(new Date(from.getTime() + i * 86_400_000), h.timezone);
    if (!h.days.includes(p.weekday)) continue;
    for (let k = 0; k < o.preferredTimes.length; k++) {
      const hhmm = o.preferredTimes[(i + k) % o.preferredTimes.length] ?? h.start;
      const startMin = toMinutes(hhmm);
      if (startMin < toMinutes(h.start) || startMin + o.durationMinutes > end) continue;
      const s = zoned(p.y, p.m, p.d, startMin, h.timezone);
      const e = s.getTime() + o.durationMinutes * 60_000;
      if (s.getTime() < earliest) continue;
      if (busy.some((b) => b.start.getTime() < e && b.end.getTime() > s.getTime())) continue;
      out.push(s);
      break;
    }
  }
  return out;
}
