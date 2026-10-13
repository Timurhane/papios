import {
  ACTION_LABEL,
  describeSchedule,
  diffSiteFeatures,
  formatTl,
  localDate,
  mrr,
  nextRun,
  redactPersonal,
  routineParams,
  ROUTINE_ACTIONS,
  siteFeatures,
  suggestPlaybookChanges,
  suggestRules,
  validateRoutine,
  type LLMService,
  type RoutineSpec,
  type SiteSignals,
} from '@papi/core';
import {
  intelCompanyNews,
  intelCompetitors,
  intelSectorNews,
  kalemContent,
  routineParse,
} from '@papi/prompts';
import { z } from 'zod';
import type { CompanyRow, Repo, RoutineRow } from '../repo/types.ts';
import { draftMonthlyReports, notifyOverdue, syncCharges, type OpsDeps } from './operator.ts';

/** Phase 6: routines (K-13.5), night shift (K-15.5), signals (K-8.11), Kalem (K-13.9), learning (K-6.8, K-11.6). */
export interface AutomationDeps {
  repo: Repo;
  llm: LLMService;
  /** Telegram delivery, respecting quiet mode and preferences (daily_report is held at night). */
  notify?: (
    kind: 'daily_report' | 'approval_pending' | 'business_news' | 'system_error',
    text: string,
  ) => Promise<void>;
  ops?: OpsDeps;
  panelUrl?: string;
  /** Starts the heavy-jobs workflow right away (optional token). */
  dispatchHeavy?: () => Promise<void>;
  now?: () => Date;
}

const TZ = 'Europe/Istanbul';
const now = (d: { now?: () => Date }) => d.now?.() ?? new Date();

// --- routine engine -------------------------------------------------------------------------------

/**
 * Every cron minute: due routines are queued (one job each) and moved to their next run. A routine
 * seen for the first time only gets its next run scheduled (it does not fire immediately).
 */
export async function tickRoutines(deps: Pick<AutomationDeps, 'repo' | 'now'>): Promise<number> {
  const t = now(deps);
  let queued = 0;
  for (const r of await deps.repo.dueRoutines(t, 10)) {
    const next = nextRun(r.schedule, t, TZ).toISOString();
    if (r.next_run_at === null) {
      await deps.repo.updateRoutine(r.id, { next_run_at: next });
      continue;
    }
    // next_run_at moves on below, so each due time is queued once (`unique` is per job type)
    await deps.repo.enqueue('routine.run', { routineId: r.id, at: r.next_run_at }, { priority: 3 });
    await deps.repo.updateRoutine(r.id, { next_run_at: next, last_run_at: t.toISOString() });
    queued++;
  }
  return queued;
}

/** Runs one routine (job handler). The result is stored and, when there is something to say, sent. */
export async function runRoutine(deps: AutomationDeps, routineId: string): Promise<string | null> {
  const r = await deps.repo.getRoutine(routineId);
  if (!r || !r.enabled) return null;
  const params = routineParams[r.action].safeParse(r.params);
  if (!params.success) {
    await deps.repo.updateRoutine(r.id, { last_result: 'Geçersiz parametreler' });
    return null;
  }
  const text = await ACTIONS[r.action](deps, params.data as never, r);
  await deps.repo.updateRoutine(r.id, {
    last_result: (text ?? 'Bildirilecek bir şey yok').slice(0, 300),
  });
  await deps.repo.audit(
    'routine.run',
    { routine: r.code, action: r.action },
    { type: 'agent', id: 'papi' },
  );
  if (text) await deps.notify?.('daily_report', text);
  return text;
}

type Action<A extends keyof typeof routineParams> = (
  deps: AutomationDeps,
  params: z.infer<(typeof routineParams)[A]>,
  routine: RoutineRow,
) => Promise<string | null>;

const lines = (title: string, items: string[], empty: string) =>
  [title, ...(items.length ? items : [empty])].join('\n');

const morningBrief: Action<'morning_brief'> = async (deps) => {
  const [approvals, ready, due, usage] = await Promise.all([
    deps.repo.listPendingApprovals(100),
    deps.repo.touchesByStatus(['ready'], 100),
    deps.repo.duePayments(100),
    deps.repo.usageSummary(),
  ]);
  const today = localDate(now(deps), TZ);
  const calls = ready.filter((t) => t.channel === 'phone_call' || t.channel === 'visit').length;
  const overdue = due.filter((p) => p.due_on < today);
  return [
    '☀️ Günaydın, bugün:',
    `• Onay bekleyen: ${approvals.length}`,
    `• Tek tık mesaj: ${ready.length - calls} · arama/ziyaret: ${calls}`,
    overdue.length
      ? `• Geciken tahsilat: ${overdue.length} (${formatTl(overdue.reduce((n, p) => n + p.amount_kurus, 0))})`
      : null,
    usage.errors24h ? `• ⚠️ Son 24 saatte hata: ${usage.errors24h}` : null,
    deps.panelUrl ? `\n${deps.panelUrl.replace(/\/$/, '')}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const whomToCall: Action<'whom_to_call'> = async (deps, p) => {
  const [ready, sent] = await Promise.all([
    deps.repo.touchesByStatus(['ready'], 100),
    deps.repo.proposalsByStatus(['sent'], 50),
  ]);
  const items: string[] = [];
  for (const t of ready.filter((x) => x.channel === 'phone_call').slice(0, p.limit)) {
    const c = await deps.repo.getCompany(t.company_id);
    items.push(`• ${c?.name ?? 'Firma'}${t.recipient ? ` — +${t.recipient}` : ''} (dizi adımı)`);
  }
  const cutoff = now(deps).getTime() - 5 * 86_400_000;
  for (const pr of sent
    .filter((x) => x.sent_at && Date.parse(x.sent_at) < cutoff)
    .slice(0, Math.max(0, p.limit - items.length))) {
    const c = await deps.repo.getCompany(pr.company_id);
    items.push(`• ${c?.name ?? 'Firma'} — teklif ${pr.number} 5 günden eski, durumunu sor`);
  }
  return lines('📞 Bugün aranacaklar:', items, 'Bugün için arama yok.');
};

const signalScan: Action<'signal_scan'> = async (deps, p) => {
  await deps.repo.enqueue(
    'signals.site_scan',
    { limit: p.site_limit },
    { heavy: true, unique: true },
  );
  if (p.news_limit > 0)
    await deps.repo.enqueue('signals.news', { limit: p.news_limit }, { heavy: true, unique: true });
  await deps.repo.enqueue('signals.osm_new', {}, { heavy: true, unique: true });
  await deps.dispatchHeavy?.().catch(() => undefined);
  return null; // the heavy worker reports what it finds
};

const competitorScan: Action<'competitor_scan'> = async (deps) => {
  const s = await deps.repo.getSettings();
  if (!s.intelligence.competitors.length)
    return '🔎 Rakip taraması: rakip listesi boş (Ayarlar → Zeka → Rakipler).';
  await deps.repo.enqueue('intel.competitors', {}, { heavy: true, unique: true });
  await deps.dispatchHeavy?.().catch(() => undefined);
  return null;
};

const sectorNews: Action<'sector_news'> = async (deps) => {
  await deps.repo.enqueue('intel.sector_news', {}, { heavy: true, unique: true });
  await deps.dispatchHeavy?.().catch(() => undefined);
  return null;
};

const paymentCheck: Action<'payment_check'> = async (deps) => {
  if (!deps.ops) return null;
  await syncCharges(deps.ops, localDate(now(deps), TZ));
  await notifyOverdue(deps.ops);
  return null; // overdue alerts are sent individually
};

const monthlyReports: Action<'monthly_reports'> = async (deps) => {
  if (!deps.ops) return null;
  const n = await draftMonthlyReports(deps.ops);
  return n ? `📊 ${n} aylık müşteri raporu onay bekliyor: /onaylar` : null;
};

const weeklySummary: Action<'weekly_summary'> = async (deps) => {
  const since = new Date(now(deps).getTime() - 7 * 86_400_000);
  const [stats, act, subs, s] = await Promise.all([
    deps.repo.salesStats(7),
    deps.repo.activitySince(since),
    deps.repo.activeSubscriptions(500),
    deps.repo.getSettings(),
  ]);
  const m = mrr(subs, localDate(now(deps), TZ));
  const target = s.revenue_target.monthly_kurus;
  return [
    '📈 Haftalık patron özeti',
    `• Aylık yinelenen gelir: ${formatTl(m)}${target ? ` (hedefe kalan ${formatTl(Math.max(0, target - m))})` : ''}`,
    `• Hattaki teklifler: ${formatTl(stats.pipelineKurus)}/ay`,
    `• Temas ${stats.contacted} → cevap ${stats.replied} → olumlu ${stats.positive} → görüşme ${stats.meetings} → teklif ${stats.proposals} → kazanım ${stats.won}`,
    `• Yeni aday ${act.newCompanies}, analiz ${act.analyses}, sinyal ${act.signals}`,
    act.errors ? `• ⚠️ Hata: ${act.errors}` : null,
  ]
    .filter(Boolean)
    .join('\n');
};

const hotLeads: Action<'hot_leads_digest'> = async (deps, p) => {
  const top = await deps.repo.topCompanies(p.min_score, p.limit);
  return lines(
    `🔥 ${p.min_score}+ puanlı açık adaylar:`,
    top.map((c) => `• ${c.name} — ${c.score} (${c.city ?? 'il yok'})`),
    'Bu puanın üstünde açık aday yok.',
  );
};

const pipelineDigest: Action<'pipeline_digest'> = async (deps) => {
  const open = await deps.repo.proposalsByStatus(['approved', 'sent'], 50);
  const items: string[] = [];
  for (const p of open) {
    const c = await deps.repo.getCompany(p.company_id);
    items.push(
      `• ${c?.name ?? 'Firma'} — ${p.number} (${p.status === 'sent' ? 'gönderildi' : 'onaylı, gönderilmedi'})${p.monthly_kurus ? ` ${formatTl(p.monthly_kurus)}/ay` : ''}`,
    );
  }
  return lines('📄 Satış hattı:', items, 'Açık teklif yok.');
};

const reminder: Action<'reminder'> = async (_deps, p) => `⏰ Hatırlatma: ${p.text}`;

const contentPlan: Action<'content_plan'> = async (deps, p) => {
  const n = await planContent(deps, p.per_platform);
  return n ? `✍️ Kalem ${n} içerik taslağı hazırladı: /onaylar` : null;
};

const learningReviewAction: Action<'learning_review'> = async (deps) => {
  const n = await learningReview(deps);
  return n ? `🧠 ${n} yeni öğrenme önerisi onay bekliyor: /onaylar` : null;
};

const ACTIONS: { [A in keyof typeof routineParams]: Action<A> } = {
  morning_brief: morningBrief,
  whom_to_call: whomToCall,
  signal_scan: signalScan,
  competitor_scan: competitorScan,
  sector_news: sectorNews,
  payment_check: paymentCheck,
  monthly_reports: monthlyReports,
  weekly_summary: weeklySummary,
  hot_leads_digest: hotLeads,
  pipeline_digest: pipelineDigest,
  reminder,
  content_plan: contentPlan,
  learning_review: learningReviewAction,
};

// --- natural-language routines (K-13.5) ---------------------------------------------------------

const ACTION_HELP: Record<string, string> = {
  morning_brief: 'günün özeti (onaylar, tek tık, gecikmeler)',
  whom_to_call: 'aranacaklar listesi; params: {"limit": 1-20}',
  signal_scan: 'sinyal taraması (site, haber, yeni işletmeler)',
  competitor_scan: 'rakip taraması',
  sector_news: 'sektör haberlerinden fırsat',
  payment_check: 'ödeme gecikme kontrolü',
  monthly_reports: 'aylık müşteri raporları',
  weekly_summary: 'haftalık patron özeti',
  hot_leads_digest: 'sıcak adaylar özeti; params: {"min_score": 0-100, "limit": 1-20}',
  pipeline_digest: 'açık teklifler özeti',
  reminder: 'Timurhan\'a hatırlatma mesajı; params: {"text": "..."}',
  content_plan: 'haftalık içerik taslakları; params: {"per_platform": 1-3}',
  learning_review: 'öğrenen sistem önerileri',
};

const parsedSchema = z.object({
  name: z.string(),
  action: z.string(),
  schedule: z.record(z.string(), z.unknown()),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** Model → structure only; the result must pass the allowlist and schema checks (validateRoutine). */
export async function parseRoutineRequest(
  deps: Pick<AutomationDeps, 'llm'>,
  text: string,
): Promise<RoutineSpec | null> {
  const { data } = await deps.llm.generateStructured({
    agent: 'papi',
    task: 'papi.routine_parse',
    tier: 'light',
    dataClass: 'internal',
    promptId: routineParse.id,
    promptVersion: routineParse.version,
    system: `${routineParse.text}\n\nEylemler:\n${ROUTINE_ACTIONS.map((a) => `- ${a}: ${ACTION_HELP[a]}`).join('\n')}`,
    messages: [{ role: 'user', content: text.slice(0, 500) }],
    schema: parsedSchema,
    schemaHint:
      '{"name":"...","action":"hot_leads_digest","schedule":{"kind":"weekly","time":"09:00","days":[1]},"params":{}}',
  });
  if (data.action === 'none') return null;
  return validateRoutine(data);
}

export function describeRoutine(spec: Pick<RoutineSpec, 'name' | 'schedule' | 'action'>): string {
  return `${spec.name} — ${describeSchedule(spec.schedule)} — ${ACTION_LABEL[spec.action]}`;
}

export async function saveRoutine(
  deps: Pick<AutomationDeps, 'repo' | 'now'>,
  spec: RoutineSpec,
  source: 'telegram' | 'panel',
): Promise<string> {
  const id = await deps.repo.createRoutine({
    code: `ozel_${crypto.randomUUID().slice(0, 8)}`,
    name: spec.name,
    schedule: spec.schedule,
    action: spec.action,
    params: spec.params,
    source,
    next_run_at: nextRun(spec.schedule, now(deps), TZ).toISOString(),
  });
  await deps.repo.audit('routine.created', { routine_id: id, action: spec.action, source });
  return id;
}

// --- night shift (K-15.5) ---------------------------------------------------------------------------

export interface NightShift {
  started_at: string;
  searches: number;
  cursor: number;
}

export async function startNightShift(deps: Pick<AutomationDeps, 'repo' | 'now'>): Promise<void> {
  await deps.repo.setState('night_shift', {
    started_at: now(deps).toISOString(),
    searches: 0,
    cursor: 0,
  } satisfies NightShift);
}

/**
 * While quiet: queue new-lead searches (OSM area × sector, rotating) within the nightly budget. Analysis,
 * scoring and drafting run on their own from the queue; mail still waits for business hours.
 */
export async function nightShiftTick(deps: AutomationDeps): Promise<number> {
  const shift = await deps.repo.getState<NightShift>('night_shift');
  if (!shift) return 0;
  const s = await deps.repo.getSettings();
  const pairs = s.night_shift.areas.flatMap((a) =>
    s.night_shift.sectors.map((sec) => [a, sec] as const),
  );
  if (!pairs.length || shift.searches >= s.night_shift.max_searches_per_night) return 0;
  const [area, sector] = pairs[shift.cursor % pairs.length] as readonly [string, string];
  await deps.repo.enqueue('kasif.osm_search', { area, sectors: [sector] }, { heavy: true });
  await deps.repo.setState('night_shift', {
    ...shift,
    searches: shift.searches + 1,
    cursor: shift.cursor + 1,
  } satisfies NightShift);
  await deps.dispatchHeavy?.().catch(() => undefined);
  return 1;
}

/** True when the night's draft budget is used up (outreach drafting pauses until morning). */
export async function nightDraftBudgetUsed(deps: Pick<AutomationDeps, 'repo'>): Promise<boolean> {
  const shift = await deps.repo.getState<NightShift>('night_shift');
  if (!shift) return false;
  const s = await deps.repo.getSettings();
  const act = await deps.repo.activitySince(new Date(shift.started_at));
  return act.approvalsCreated >= s.night_shift.max_drafts_per_night;
}

/** "/uyandim": what the night shift did. Clears the shift. */
export async function endNightShift(deps: Pick<AutomationDeps, 'repo'>): Promise<string[] | null> {
  const shift = await deps.repo.getState<NightShift>('night_shift');
  if (!shift) return null;
  await deps.repo.setState('night_shift', null);
  const a = await deps.repo.activitySince(new Date(shift.started_at));
  return [
    `🌙 Gece vardiyası (${shift.searches} arama başlatıldı):`,
    `• Yeni aday: ${a.newCompanies} · analiz: ${a.analyses} · sinyal: ${a.signals}`,
    `• Hazırlanan taslak/onay: ${a.approvalsCreated}`,
    a.replies ? `• Gelen cevap: ${a.replies}` : null,
    a.errors ? `• ⚠️ Hata: ${a.errors}` : null,
  ].filter((x): x is string => x !== null);
}

// --- signals (K-8.11) ---------------------------------------------------------------------------------

/** ISO week label, used to fingerprint a change once per week. */
export function weekLabel(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear();
  const week = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86_400_000 + 1) / 7);
  return `${y}-W${String(week).padStart(2, '0')}`;
}

const OPEN_STAGES = new Set(['analyzed', 'waitlist', 'new']);

/** A new signal on an idle lead moves it to the Sinyal playbook (rescore happens in the analysis job). */
async function actOnSignal(repo: Repo, c: CompanyRow, description: string) {
  await repo.addCompanyEvent(c.id, 'signal', description);
  if (OPEN_STAGES.has(c.stage)) {
    await repo.updateCompany(c.id, {
      stage: 'analyzed',
      next_step_kind: 'playbook',
      assigned_playbook: 'sinyal',
      waiting_reason: null,
      waiting_until: null,
    });
    await repo.enqueue('analysis.batch', { companyIds: [c.id] }, { heavy: true });
  }
}

/** Compares this week's site features with the last snapshot; records and acts on changes. */
export async function applySiteScan(
  deps: Pick<AutomationDeps, 'repo' | 'now'>,
  company: CompanyRow,
  signals: SiteSignals,
): Promise<string[]> {
  const cur = siteFeatures(signals);
  const prev = await deps.repo.siteSnapshot(company.id);
  await deps.repo.saveSiteSnapshot(company.id, cur);
  const out: string[] = [];
  for (const ch of diffSiteFeatures(prev, cur, weekLabel(now(deps)))) {
    const isNew = await deps.repo.addSignal({
      companyId: company.id,
      kind: ch.kind,
      description: ch.description,
      fingerprint: ch.fingerprint,
      sourceUrl: company.website_url,
    });
    if (!isNew) continue;
    out.push(ch.description);
    await actOnSignal(deps.repo, company, ch.description);
  }
  return out;
}

const newsSchema = z.object({
  items: z
    .array(
      z.object({
        kind: z.enum(['new_opening', 'job_posting', 'growth', 'campaign', 'bad_reviews', 'news']),
        description: z.string().min(3).max(300),
        url: z.string().nullable(),
      }),
    )
    .max(5),
});

/** Grounded news check for one company (public data only). */
export async function newsScan(
  deps: Pick<AutomationDeps, 'repo' | 'llm' | 'now'>,
  company: CompanyRow,
): Promise<string[]> {
  const { data } = await deps.llm.generateStructured({
    agent: 'kasif',
    task: 'intel.company_news',
    tier: 'light',
    dataClass: 'public',
    grounding: true,
    promptId: intelCompanyNews.id,
    promptVersion: intelCompanyNews.version,
    system: intelCompanyNews.text,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          isletme: company.name,
          il: company.city,
          web: company.website_url,
        }),
      },
    ],
    schema: newsSchema,
    schemaHint: '{"items":[{"kind":"new_opening","description":"...","url":"https://..."}]}',
  });
  const out: string[] = [];
  for (const it of data.items) {
    const fp = `news:${(it.url ?? it.description).toLocaleLowerCase('tr').slice(0, 120)}`;
    if (
      !(await deps.repo.addSignal({
        companyId: company.id,
        kind: it.kind,
        description: it.description,
        fingerprint: fp,
        sourceUrl: it.url,
      }))
    )
      continue;
    out.push(it.description);
    await actOnSignal(deps.repo, company, `Haber: ${it.description}`);
  }
  return out;
}

const digestSchema = z.object({ text: z.string().min(1).max(3000) });

/** Weekly competitor / sector digests (grounded, public data). */
export async function intelDigest(
  deps: Pick<AutomationDeps, 'repo' | 'llm'>,
  kind: 'competitors' | 'sector',
): Promise<string> {
  const s = await deps.repo.getSettings();
  const prompt = kind === 'competitors' ? intelCompetitors : intelSectorNews;
  const input =
    kind === 'competitors'
      ? { rakipler: s.intelligence.competitors }
      : { sektorler: s.intelligence.news_sectors };
  const { data } = await deps.llm.generateStructured({
    agent: 'kasif',
    task: prompt.id,
    tier: 'medium',
    dataClass: 'public',
    grounding: true,
    promptId: prompt.id,
    promptVersion: prompt.version,
    system: prompt.text,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
    schema: digestSchema,
    schemaHint: '{"text":"• ...\\n• ..."}',
  });
  return `${kind === 'competitors' ? '🔎 Rakip taraması' : '📰 Sektörden fırsatlar'}\n\n${data.text}`;
}

// --- Kalem (K-13.9) -------------------------------------------------------------------------------------

const contentSchema = z.object({
  items: z
    .array(
      z.object({
        platform: z.enum(['linkedin', 'x', 'instagram']),
        topic: z.string().min(2).max(120),
        body: z.string().min(10).max(2200),
      }),
    )
    .min(1)
    .max(9),
});

/** No city or region names in promotional content (K-13.9); checked by code, not trusted to the model. */
export function mentionsPlace(text: string, places: string[]): string | null {
  const t = text.toLocaleLowerCase('tr');
  return places.find((p) => p && t.includes(p.toLocaleLowerCase('tr'))) ?? null;
}

const TR_PLACES = [
  'Balıkesir',
  'İstanbul',
  'Ankara',
  'İzmir',
  'Bursa',
  'Antalya',
  'Marmara',
  'Ege',
  'Türkiye',
];

export async function planContent(deps: AutomationDeps, perPlatform: number): Promise<number> {
  const s = await deps.repo.getSettings();
  const knowledge = await deps.repo.searchKnowledgeByText('', 8);
  const { data } = await deps.llm.generateStructured({
    agent: 'kalem',
    task: 'kalem.content',
    tier: 'medium',
    dataClass: 'internal',
    promptId: kalemContent.id,
    promptVersion: kalemContent.version,
    system: kalemContent.text,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          platform_basina: perPlatform,
          bilgi_bankasi: knowledge.map((k) => `${k.title}: ${k.content}`.slice(0, 400)),
        }),
      },
    ],
    schema: contentSchema,
    schemaHint: '{"items":[{"platform":"linkedin","topic":"...","body":"..."}]}',
    noCache: true,
  });
  const places = [...TR_PLACES, ...s.region_priority.map((r) => r.name), ...s.night_shift.areas];
  const week = localDate(now(deps), TZ);
  let made = 0;
  for (const it of data.items) {
    if (mentionsPlace(`${it.topic} ${it.body}`, places)) continue; // K-13.9
    const id = await deps.repo.addContentItem({
      platform: it.platform,
      week_of: week,
      topic: it.topic,
      body: it.body,
    });
    const approvalId = await deps.repo.createApproval({
      kind: 'content',
      title: `İçerik (${it.platform === 'x' ? 'X' : it.platform === 'linkedin' ? 'LinkedIn' : 'Instagram'}): ${it.topic}`,
      payload: {
        text: it.body,
        personal: it.body,
        draftKind: `content_${it.platform}`,
        contentId: id,
      },
      agent: 'kalem',
    });
    await deps.repo.updateContentItem(id, { approval_id: approvalId });
    made++;
  }
  return made;
}

// --- learning (K-6.8, K-11.6) ----------------------------------------------------------------------------

export async function learningReview(deps: Pick<AutomationDeps, 'repo'>): Promise<number> {
  let made = 0;
  for (const r of suggestRules(await deps.repo.correctionInstructions(60))) {
    const id = await deps.repo.addSuggestion({
      kind: 'learned_rule',
      title: `Kalıcı kural: "${r.rule}"`,
      detail: { rule: r.rule, count: r.count, examples: r.examples },
      fingerprint: r.fingerprint,
    });
    if (!id) continue;
    const approvalId = await deps.repo.createApproval({
      kind: 'suggestion',
      title: `Öğrenilen kural önerisi (${r.count} kez düzelttin): ${r.rule}`,
      payload: {
        text: `Taslaklarda şu düzeltmeyi ${r.count} kez yaptın:\n${r.examples.map((e) => `• ${e}`).join('\n')}\n\nKalıcı kural olsun mu? "${r.rule}"`,
        suggestionId: id,
      },
      agent: 'papi',
    });
    await deps.repo.updateSuggestion(id, { approval_id: approvalId });
    made++;
  }
  for (const p of suggestPlaybookChanges(await deps.repo.stepStats())) {
    const id = await deps.repo.addSuggestion({
      kind: 'playbook_change',
      title: p.title,
      detail: { reason: p.reason },
      fingerprint: p.fingerprint,
    });
    if (!id) continue;
    const approvalId = await deps.repo.createApproval({
      kind: 'suggestion',
      title: `Playbook önerisi: ${p.title}`,
      payload: {
        text: `${p.title}\nNeden: ${p.reason}\n\nOnaylarsan not alınır; adımı Playbook'lar ekranından düzenlersin.`,
        suggestionId: id,
      },
      agent: 'papi',
    });
    await deps.repo.updateSuggestion(id, { approval_id: approvalId });
    made++;
  }
  return made;
}

/** Content and suggestion approvals (Telegram inline or panel reconcile). */
export async function onAutomationDecided(
  deps: Pick<AutomationDeps, 'repo'>,
  approvalId: string,
  decision: 'approved' | 'rejected',
): Promise<'content' | 'suggestion' | null> {
  const content = await deps.repo.contentByApproval(approvalId);
  if (content && content.status === 'awaiting_approval') {
    await deps.repo.updateContentItem(content.id, {
      status: decision === 'approved' ? 'approved' : 'rejected',
    });
    return 'content';
  }
  const sg = await deps.repo.suggestionByApproval(approvalId);
  if (sg && sg.status === 'pending') {
    await deps.repo.updateSuggestion(sg.id, {
      status: decision === 'approved' ? 'accepted' : 'rejected',
    });
    if (decision === 'approved' && sg.kind === 'learned_rule' && typeof sg.detail.rule === 'string')
      await deps.repo.addToneRule(sg.detail.rule);
    return 'suggestion';
  }
  return null;
}

/** Panel decisions (approval row only) on content and suggestions are applied by the Worker. */
export async function reconcileAutomationDecisions(
  deps: Pick<AutomationDeps, 'repo'>,
  limit = 10,
): Promise<number> {
  let n = 0;
  for (const id of await deps.repo.automationApprovalsAwaiting(20)) {
    if (n >= limit) break;
    const a = await deps.repo.getApproval(id);
    if (!a || (a.status !== 'approved' && a.status !== 'rejected')) continue;
    if (await onAutomationDecided(deps, a.id, a.status)) n++;
  }
  return n;
}

// --- geocoding (K-3.18) ------------------------------------------------------------------------------------

/**
 * Nominatim usage policy: identifying User-Agent, cached results, attribution; scripts that run at
 * regular intervals are limited to 4 requests per minute, hence one request every 15 seconds.
 */
export const NOMINATIM_GAP_MS = 15_000;
export async function geocodeCompanies(
  deps: Pick<AutomationDeps, 'repo'>,
  limit: number,
  fetchImpl: typeof fetch = (...a) => fetch(...a),
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<{ found: number; missing: number }> {
  let found = 0;
  let missing = 0;
  for (const c of await deps.repo.companiesNeedingGeocode(limit)) {
    const query = [c.address, c.district, c.city, 'Türkiye'].filter(Boolean).join(', ');
    const key = query.toLocaleLowerCase('tr');
    let hit = await deps.repo.geocodeCached(key);
    if (!hit) {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=tr&q=${encodeURIComponent(query)}`;
      const res = await fetchImpl(url, {
        headers: { 'user-agent': 'PapiBot/1.0 (+https://ajnadigitalagency.com)' },
      });
      const rows = res.ok ? ((await res.json()) as { lat?: string; lon?: string }[]) : [];
      const r = rows[0];
      hit =
        r?.lat && r.lon
          ? { lat: Number(r.lat), lng: Number(r.lon), found: true }
          : { lat: null, lng: null, found: false };
      if (res.ok) await deps.repo.cacheGeocode(key, hit);
      await sleep(NOMINATIM_GAP_MS);
    }
    await deps.repo.setCompanyLocation(c.id, hit.lat, hit.lng);
    if (hit.found) found++;
    else missing++;
  }
  return { found, missing };
}

/** Papi tool: notes by meaning (embedding of the redacted query, K-4.9). */
export async function searchNotes(
  deps: Pick<AutomationDeps, 'repo' | 'llm'>,
  query: string,
  limit = 5,
) {
  const [v] = await deps.llm.embed([redactPersonal(query).text], {
    agent: 'papi',
    task: 'notes.search',
    dataClass: 'internal',
  });
  if (!v) return [];
  return deps.repo.searchNotesByVector(v, limit);
}
