import { describe, expect, it } from 'vitest';
import { meetingSlots } from '../outreach/schedule.ts';
import { defaultSettings } from '../settings/defaults.ts';

const h = defaultSettings.business_hours;
const opts = {
  count: 3,
  durationMinutes: 30,
  leadHours: 4,
  horizonDays: 10,
  preferredTimes: ['10:00', '14:00', '11:30', '16:00'],
};
const tr = (d: Date) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

describe('meetingSlots', () => {
  it('one slot per business day, after the lead time, skipping weekends', () => {
    // Thu 15 Oct 2026, 15:00 TR
    const slots = meetingSlots(new Date('2026-10-15T12:00:00Z'), h, [], opts);
    expect(slots.map(tr)).toEqual(['Cum 14:00', 'Pzt 10:00', 'Sal 14:00']);
  });

  it('avoids busy ranges', () => {
    const busy = [
      { start: new Date('2026-10-16T10:30:00Z'), end: new Date('2026-10-16T12:00:00Z') }, // Fri 13:30–15:00 TR
    ];
    const slots = meetingSlots(new Date('2026-10-15T12:00:00Z'), h, busy, opts);
    expect(tr(slots[0]!)).toBe('Cum 11:30');
  });
});
