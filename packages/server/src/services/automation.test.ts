import {
  defaultSettings,
  LLMService,
  type LLMProvider,
  type ProviderGenerateInput,
  type SiteSignals,
} from '@papi/core';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../repo/memory.ts';
import {
  applySiteScan,
  endNightShift,
  geocodeCompanies,
  learningReview,
  newsScan,
  nightShiftTick,
  onAutomationDecided,
  parseRoutineRequest,
  planContent,
  reconcileAutomationDecisions,
  runRoutine,
  saveRoutine,
  startNightShift,
  tickRoutines,
  type AutomationDeps,
} from './automation.ts';

// Tue 13 Oct 2026 10:00 Istanbul
const NOW = new Date('2026-10-13T07:00:00Z');

function setup(replies: unknown[] = []) {
  const repo = new MemoryRepo();
  let clock = NOW;
  repo.now = () => clock;
  const calls: ProviderGenerateInput[] = [];
  const gemini: LLMProvider = {
    id: 'gemini',
    supportsGrounding: true,
    async generate(input) {
      calls.push(input);
      return { text: JSON.stringify(replies.shift() ?? {}), usage: { tokensIn: 1, tokensOut: 1 } };
    },
  };
  const settings = structuredClone(defaultSettings.llm);
  settings.quotas.gemini = { ...settings.quotas.gemini!, rpm: 1000, rpd: 1000 };
  settings.quotas.gemini_ground = { ...settings.quotas.gemini_ground!, rpm: 1000, rpd: 1000 };
  const llm = new LLMService({ providers: { gemini }, settings, store: repo.llmStore });
  const sent: { kind: string; text: string }[] = [];
  const deps: AutomationDeps = {
    repo,
    llm,
    notify: async (kind, text) => void sent.push({ kind, text }),
    now: () => clock,
  };
  return { repo, deps, calls, sent, setNow: (d: Date) => (clock = d) };
}

describe('Phase 6 acceptance: routines run on time', () => {
  it('first sight schedules; when due it is queued once and moved to the next run', async () => {
    const { repo, deps, setNow } = setup();
    const id = await repo.createRoutine({
      code: 'sabah_brifingi',
      name: 'Sabah brifingi',
      schedule: { kind: 'weekdays', time: '08:45' },
      action: 'morning_brief',
      params: {},
      source: 'preset',
      next_run_at: '',
    });
    repo.routines[0]!.next_run_at = null;
    expect(await tickRoutines(deps)).toBe(0);
    expect(repo.routines[0]!.next_run_at).toBe('2026-10-14T05:45:00.000Z'); // Wed 08:45 TR

    setNow(new Date('2026-10-14T05:45:30Z'));
    expect(await tickRoutines(deps)).toBe(1);
    expect(repo.jobs.filter((j) => j.type === 'routine.run')).toHaveLength(1);
    expect(repo.routines[0]!.next_run_at).toBe('2026-10-15T05:45:00.000Z');
    expect(await tickRoutines(deps)).toBe(0);

    // two different routines due in the same minute are both queued
    await saveRoutine(
      deps,
      {
        name: 'A',
        schedule: { kind: 'daily', time: '09:00' },
        action: 'reminder',
        params: { text: 'a' },
      },
      'panel',
    );
    await saveRoutine(
      deps,
      {
        name: 'B',
        schedule: { kind: 'daily', time: '09:00' },
        action: 'reminder',
        params: { text: 'b' },
      },
      'panel',
    );
    setNow(new Date('2026-10-14T06:00:10Z'));
    expect(await tickRoutines(deps)).toBe(2);
    expect(id).toBeTruthy();
  });

  it('runs allowlisted actions and sends their result as a daily report', async () => {
    const { repo, deps, sent } = setup();
    const id = await saveRoutine(
      deps,
      {
        name: 'Hatırlat',
        schedule: { kind: 'daily', time: '09:00' },
        action: 'reminder',
        params: { text: 'Faturaları kes' },
      },
      'telegram',
    );
    expect(await runRoutine(deps, id)).toBe('⏰ Hatırlatma: Faturaları kes');
    expect(sent).toEqual([{ kind: 'daily_report', text: '⏰ Hatırlatma: Faturaları kes' }]);
    expect(repo.routines[0]!.last_result).toBe('⏰ Hatırlatma: Faturaları kes');

    const brief = await saveRoutine(
      deps,
      {
        name: 'Brifing',
        schedule: { kind: 'daily', time: '09:00' },
        action: 'morning_brief',
        params: {},
      },
      'panel',
    );
    expect(await runRoutine(deps, brief)).toContain('Günaydın');

    repo.routines[0]!.params = { text: '' }; // corrupted parameters never run
    expect(await runRoutine(deps, id)).toBeNull();
  });

  it('natural language → allowlisted structure; unknown actions are refused', async () => {
    const { deps } = setup([
      {
        name: 'Sıcak adaylar',
        action: 'hot_leads_digest',
        schedule: { kind: 'weekly', time: '09:00', days: [1] },
        params: { min_score: 75 },
      },
      {
        name: 'Sil',
        action: 'delete_everything',
        schedule: { kind: 'daily', time: '09:00' },
        params: {},
      },
    ]);
    expect(
      await parseRoutineRequest(deps, 'Her pazartesi 9da 75 üstü sıcak adayları özetle'),
    ).toEqual({
      name: 'Sıcak adaylar',
      action: 'hot_leads_digest',
      schedule: { kind: 'weekly', time: '09:00', days: [1] },
      params: { min_score: 75, limit: 10 },
    });
    expect(await parseRoutineRequest(deps, 'her şeyi sil')).toBeNull();
  });
});

describe('Phase 6 acceptance: night shift', () => {
  it('queues lead searches within the budget and reports in the morning', async () => {
    const { repo, deps } = setup();
    await startNightShift(deps);
    for (let i = 0; i < 5; i++) await nightShiftTick(deps);
    const searches = repo.jobs.filter((j) => j.type === 'kasif.osm_search');
    expect(searches).toHaveLength(defaultSettings.night_shift.max_searches_per_night);
    expect(searches.map((j) => j.payload)).toEqual([
      { area: 'Balıkesir', sectors: ['clinic'] },
      { area: 'Balıkesir', sectors: ['real_estate'] },
    ]);
    repo.activity = { ...repo.activity, newCompanies: 12, analyses: 9, approvalsCreated: 4 };
    const summary = await endNightShift(deps);
    expect(summary?.[0]).toBe('🌙 Gece vardiyası (2 arama başlatıldı):');
    expect(summary?.[1]).toBe('• Yeni aday: 12 · analiz: 9 · sinyal: 0');
    expect(await endNightShift(deps)).toBeNull();
  });
});

const site = (over: Partial<SiteSignals> = {}): SiteSignals => ({
  url: 'https://ornek.com',
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

describe('signals (K-8.11)', () => {
  it('a site change on an idle lead is recorded once and moves it to the Sinyal playbook', async () => {
    const { repo, deps } = setup();
    const id = await repo.createCompany({
      name: 'Örnek',
      name_norm: 'ornek',
      source: 'csv',
      website_url: 'https://ornek.com',
    });
    await repo.updateCompany(id, {
      stage: 'waitlist',
      score: 65,
      next_step_kind: 'waiting',
      waiting_reason: 'x',
      waiting_until: '2027-01-01',
    });
    const c = (await repo.getCompany(id))!;
    expect(await applySiteScan(deps, c, site())).toEqual([]); // first snapshot
    expect(await applySiteScan(deps, c, site({ booking: true }))).toEqual([
      'Siteye online randevu eklendi',
    ]);
    const after = await repo.getCompany(id);
    expect(after).toMatchObject({
      stage: 'analyzed',
      assigned_playbook: 'sinyal',
      next_step_kind: 'playbook',
    });
    expect(repo.jobs.some((j) => j.type === 'analysis.batch')).toBe(true);
    await repo.saveSiteSnapshot(id, { ...repo.snapshots.get(id)!, booking: false });
    expect(await applySiteScan(deps, c, site({ booking: true }))).toEqual([]); // same change, same week
  });

  it('grounded news becomes a signal', async () => {
    const { repo, deps, calls } = setup([
      {
        items: [
          {
            kind: 'new_opening',
            description: 'Bursa’da ikinci şube açtı',
            url: 'https://haber.example/1',
          },
        ],
      },
    ]);
    const id = await repo.createCompany({ name: 'Örnek', name_norm: 'ornek', source: 'csv' });
    const c = (await repo.getCompany(id))!;
    expect(await newsScan(deps, c)).toEqual(['Bursa’da ikinci şube açtı']);
    expect(repo.signalRows[0]).toMatchObject({ kind: 'new_opening' });
    expect(calls[0]?.grounding).toBe(true);
  });
});

describe('Kalem and learning', () => {
  it('content with a place name is dropped (K-13.9); approval marks the rest approved', async () => {
    const { repo, deps } = setup([
      {
        items: [
          {
            platform: 'linkedin',
            topic: 'Kaçan mesajlar',
            body: 'Gece gelen mesajlar sabaha kalıyorsa müşteri kaybediyorsunuz.',
          },
          { platform: 'x', topic: 'Balıkesir', body: 'Balıkesir işletmeleri için otomasyon!' },
        ],
      },
    ]);
    expect(await planContent(deps, 1)).toBe(1);
    const a = repo.approvals.find((x) => x.kind === 'content')!;
    a.status = 'approved';
    expect(await reconcileAutomationDecisions(deps)).toBe(1);
    expect(repo.contentItems[0]?.status).toBe('approved');
  });

  it('repeated corrections become a rule suggestion; accepting adds it to the tone profile', async () => {
    const { repo, deps } = setup();
    for (const i of ['Ünlem kullanma', 'ünlem kullanmayalım', 'Lütfen ünlem kullanma!'])
      repo.styleMemory.push({
        draftKind: 'outreach_email',
        verdict: 'edited',
        original: 'x',
        instruction: i,
        revised: null,
      });
    repo.steps = [{ playbook: 'Soğuk Ana', position: 5, angle: 'Telefon', sent: 30, replies: 0 }];
    expect(await learningReview(deps)).toBe(2);
    expect(await learningReview(deps)).toBe(0); // same suggestions are not repeated
    const rule = repo.approvals.find((x) => x.title.startsWith('Öğrenilen kural'))!;
    expect(await onAutomationDecided(deps, rule.id, 'approved')).toBe('suggestion');
    expect(repo.tone.donts).toContain('Ünlem kullanma');
  });
});

describe('geocoding (K-3.18)', () => {
  it('uses Nominatim politely and caches results', async () => {
    const { repo, deps } = setup();
    const a = await repo.createCompany({
      name: 'A',
      name_norm: 'a',
      source: 'csv',
      address: 'Milli Kuvvetler Cd. 1',
      city: 'Balıkesir',
    });
    const b = await repo.createCompany({
      name: 'B',
      name_norm: 'b',
      source: 'csv',
      address: 'Milli Kuvvetler Cd. 1',
      city: 'Balıkesir',
    });
    const urls: string[] = [];
    const slept: number[] = [];
    const fetchImpl = (async (u: string | URL | Request, init?: RequestInit) => {
      urls.push(String(u));
      expect((init?.headers as Record<string, string>)['user-agent']).toContain('PapiBot');
      return new Response(JSON.stringify([{ lat: '39.65', lon: '27.88' }]));
    }) as typeof fetch;
    expect(await geocodeCompanies(deps, 10, fetchImpl, async (ms) => void slept.push(ms))).toEqual({
      found: 2,
      missing: 0,
    });
    expect(urls).toHaveLength(1); // second identical address came from the cache
    expect(slept).toEqual([1100]);
    expect(repo.locations.get(a)).toEqual({ lat: 39.65, lng: 27.88 });
    expect(repo.locations.get(b)).toEqual({ lat: 39.65, lng: 27.88 });
  });
});
