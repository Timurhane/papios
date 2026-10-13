import { describe, expect, it } from 'vitest';
import type { SiteSignals } from '../analysis/html.ts';
import { suggestPlaybookChanges, suggestRules } from './learning.ts';
import { funnel, median } from './metrics.ts';
import { haversineKm, planRoute } from './route.ts';
import { describeSchedule, nextRun, validateRoutine } from './routines.ts';
import { diffSiteFeatures, siteFeatures } from './signals.ts';

const tr = (d: Date) =>
  new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);

describe('routines (K-13.5)', () => {
  // Tue 13 Oct 2026 10:00 Istanbul
  const now = new Date('2026-10-13T07:00:00Z');

  it('computes the next run in Istanbul time', () => {
    expect(tr(nextRun({ kind: 'daily', time: '09:05' }, now))).toBe('14 Çar 09:05');
    expect(tr(nextRun({ kind: 'daily', time: '17:00' }, now))).toBe('13 Sal 17:00');
    expect(tr(nextRun({ kind: 'weekdays', time: '08:45' }, new Date('2026-10-16T07:00:00Z')))).toBe(
      '19 Pzt 08:45',
    );
    expect(tr(nextRun({ kind: 'weekly', time: '17:00', days: [5] }, now))).toBe('16 Cum 17:00');
    expect(tr(nextRun({ kind: 'monthly', time: '09:20', day: 1 }, now))).toBe('1 Paz 09:20');
  });

  it('only allowlisted actions with valid parameters; defaults are filled', () => {
    expect(
      validateRoutine({
        name: 'Sıcak adaylar',
        schedule: { kind: 'weekly', time: '09:00', days: [1] },
        action: 'hot_leads_digest',
        params: {},
      }),
    ).toEqual({
      name: 'Sıcak adaylar',
      schedule: { kind: 'weekly', time: '09:00', days: [1] },
      action: 'hot_leads_digest',
      params: { min_score: 70, limit: 10 },
    });
    expect(
      validateRoutine({ name: 'x', schedule: { kind: 'daily', time: '09:00' }, action: 'run_sql' }),
    ).toBeNull();
    expect(
      validateRoutine({
        name: 'Hatırlat',
        schedule: { kind: 'daily', time: '25:00' },
        action: 'reminder',
        params: { text: 'a' },
      }),
    ).toBeNull();
    expect(
      validateRoutine({
        name: 'Hatırlat',
        schedule: { kind: 'daily', time: '09:00' },
        action: 'reminder',
        params: {},
      }),
    ).toBeNull();
  });

  it('describes schedules in Turkish', () => {
    expect(describeSchedule({ kind: 'weekly', time: '09:00', days: [1, 3] })).toBe(
      'Her Pazartesi, Çarşamba 09:00',
    );
  });
});

const site = (over: Partial<SiteSignals> = {}): SiteSignals => ({
  url: 'https://x.com',
  https: true,
  title: 'Örnek',
  description: null,
  lang: 'tr',
  generator: null,
  hasContactForm: false,
  whatsapp: false,
  booking: false,
  onlineOrder: false,
  chatWidget: null,
  socials: {},
  emails: [],
  phones: [],
  contactPageUrl: null,
  copyrightYear: null,
  branches: false,
  decisionMakerHints: [],
  textSample: '',
  ...over,
});

describe('site change signals (K-8.11)', () => {
  it('reports added channels, new job ads and campaigns; ignores ads that disappear', () => {
    const prev = siteFeatures(site({ textSample: 'Kariyer: ekibimize katılın', booking: false }));
    const cur = siteFeatures(
      site({ booking: true, textSample: 'Yeni şubemizde açılış kampanyası' }),
    );
    expect(diffSiteFeatures(prev, cur, '2026-W42').map((c) => [c.kind, c.description])).toEqual([
      ['site_change', 'Siteye online randevu eklendi'],
      ['campaign', 'Sitede yeni kampanya / açılış duyurusu var'],
    ]);
    expect(diffSiteFeatures(null, cur, 'w')).toEqual([]);
  });
});

describe('visit route (K-10.7)', () => {
  it('orders stops by nearest neighbour', () => {
    const start = { lat: 39.65, lng: 27.88 }; // Balıkesir
    const stops = [
      { id: 'far', lat: 40.19, lng: 29.06 },
      { id: 'near', lat: 39.66, lng: 27.9 },
      { id: 'mid', lat: 39.9, lng: 28.3 },
    ];
    const r = planRoute(start, stops);
    expect(r.order.map((s) => s.id)).toEqual(['near', 'mid', 'far']);
    expect(r.km).toBeGreaterThan(100);
    expect(haversineKm(start, start)).toBe(0);
  });
});

describe('learning (K-6.8, K-11.6)', () => {
  it('groups repeated corrections into a rule suggestion', () => {
    const s = suggestRules([
      'Ünlem kullanma',
      'ünlem işareti kullanmayalım',
      'Lütfen ünlem kullanma!',
      'Daha kısa yaz',
      'Fiyat verme',
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ rule: 'Ünlem kullanma', count: 3 });
  });

  it('flags steps that never get answers', () => {
    expect(
      suggestPlaybookChanges([
        { playbook: 'Soğuk Ana', position: 5, angle: 'Telefon', sent: 25, replies: 0 },
        { playbook: 'Soğuk Ana', position: 1, angle: 'Bulgu', sent: 40, replies: 4 },
        { playbook: 'Soğuk Ana', position: 7, angle: 'LinkedIn', sent: 5, replies: 0 },
      ]).map((x) => x.title),
    ).toEqual(['Soğuk Ana 5. adımı ("Telefon") değiştir ya da çıkar']);
  });
});

describe('funnel (K-16.2)', () => {
  it('computes step ratios', () => {
    const f = funnel({
      contacted: 100,
      replied: 20,
      positive: 10,
      meetings: 5,
      proposals: 4,
      won: 0,
    });
    expect(f.map((s) => s.rate)).toEqual([null, 0.2, 0.5, 0.5, 0.8, 0]);
    expect(median([5, 1, 3])).toBe(3);
    expect(median([])).toBeNull();
  });
});
