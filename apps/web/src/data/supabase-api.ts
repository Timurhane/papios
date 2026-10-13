import type { SupabaseClient } from '@supabase/supabase-js';
import {
  firstReplyHours,
  localDate,
  mrr,
  type FounderTerms,
  type Settings,
  type SubscriptionTerms,
} from '@papi/core';
import type {
  ContentItem,
  MapCompany,
  MetricsFilter,
  MetricsSummary,
  RoutineItem,
  FinanceEntry,
  FinanceSummary,
  NoteItem,
  PaymentItem,
  ProjectDetail,
  ProjectSummary,
  ApprovalItem,
  CompanySales,
  DemoSummary,
  MeetingSummary,
  ProposalDetail,
  ProposalSummary,
  SalesContext,
  ServicePackageInfo,
  Channel,
  CompanyDetail,
  CompanySummary,
  InboxItem,
  NextStepUpdate,
  OneClickItem,
  PanelApi,
  PlaybookOverview,
  PlaybookStepStat,
  TodaySummary,
} from './types';

const SUMMARY_COLUMNS =
  'id, name, city, sector, stage, score, next_step_kind, assigned_playbook, waiting_reason, waiting_until, website_url, instagram_handle, created_at, last_analyzed_at';

const INBOX_COLUMNS =
  'id, company_id, channel, from_address, subject, body, received_at, classification, handled';
const HAND_CHANNELS = ['whatsapp', 'instagram_dm', 'linkedin', 'x'];
const TASK_CHANNELS = ['phone_call', 'visit'];

type ApprovalRow = {
  id: string;
  kind: string;
  title: string;
  created_at: string;
  payload: Record<string, unknown>;
};
type TouchRow = Omit<OneClickItem, 'company_name'>;
type InboxRow = Omit<InboxItem, 'company_name'>;

const PROPOSAL_SUMMARY =
  'id, number, status, company_id, package_code, monthly_kurus, valid_until, created_at';
const PROPOSAL_DETAIL = `${PROPOSAL_SUMMARY}, quote, founder_discount, vat_mode, intro, scope, pdf_path, sent_at, approval_id`;
const DEMO_COLUMNS = 'id, company_id, token, status, expires_at, visits, messages';
const PROJECT_LIST =
  'id, name, company_id, package_code, status, started_on, contract_end, payment_path, monthly_kurus, setup_fee_kurus, project_kurus, satisfaction';
const PAYMENT_LIST = 'id, company_id, kind, amount_kurus, due_on, status, paid_on, payment_link';
const TZ = 'Europe/Istanbul';
const today = () => localDate(new Date(), TZ);
const MEETING_COLUMNS = 'id, company_id, status, starts_at, notes';

type ProposalRowDb = Omit<ProposalSummary, 'company_name'>;
type DemoRowDb = Omit<DemoSummary, 'company_name' | 'url'> & { token: string };
type MeetingRowDb = Omit<MeetingSummary, 'company_name' | 'summary'> & {
  notes: { summary?: string } | null;
};

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Panel data access through the user's own session: RLS (tenant + aal2) applies to every query. */
export function createSupabasePanelApi(db: SupabaseClient, apiUrl: string | null = null): PanelApi {
  let tenantId: string | null = null;
  const tenant = async () => {
    if (tenantId) return tenantId;
    const row = must(await db.from('tenant_members').select('tenant_id').limit(1).single()) as {
      tenant_id: string;
    };
    tenantId = row.tenant_id;
    return tenantId;
  };

  return {
    async listCompanies({ search, stage }) {
      let q = db
        .from('companies')
        .select(SUMMARY_COLUMNS)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(500);
      if (stage && stage !== 'all') q = q.eq('stage', stage);
      const s = search?.replace(/[%,()]/g, ' ').trim();
      if (s) q = q.or(`name.ilike.%${s}%,city.ilike.%${s}%,sector.ilike.%${s}%`);
      return must(await q) as CompanySummary[];
    },

    async getCompany(id) {
      const company = must(
        await db.from('companies').select('*').eq('id', id).maybeSingle(),
      ) as Omit<CompanyDetail, 'analysis' | 'contacts' | 'events'> | null;
      if (!company) return null;
      const [analysis, contacts, events] = await Promise.all([
        db
          .from('analyses')
          .select('kind, status, findings, strongest_finding, pagespeed, created_at')
          .eq('company_id', id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        db
          .from('contacts')
          .select('id, full_name, role, email, phone_e164, is_decision_maker')
          .eq('company_id', id),
        db
          .from('company_events')
          .select('id, occurred_at, kind, summary')
          .eq('company_id', id)
          .order('occurred_at', { ascending: false })
          .limit(50),
      ]);
      return {
        ...company,
        analysis: must(analysis) as CompanyDetail['analysis'],
        contacts: must(contacts) as CompanyDetail['contacts'],
        events: must(events) as CompanyDetail['events'],
      };
    },

    async setNextStep(id, step: NextStepUpdate) {
      const patch =
        step.kind === 'waiting'
          ? {
              next_step_kind: 'waiting',
              waiting_reason: step.reason,
              waiting_until: step.until,
              stage: 'waitlist',
            }
          : step.kind === 'closed'
            ? { next_step_kind: 'closed', stage: 'closed' }
            : { next_step_kind: 'playbook', assigned_playbook: step.playbook, stage: 'analyzed' };
      must(await db.from('companies').update(patch).eq('id', id));
    },

    async queueCsvImport(rows) {
      must(
        await db
          .schema('app')
          .rpc('enqueue_csv_import', { p_tenant_id: await tenant(), p_rows: rows }),
      );
    },

    async decideApproval(id, decision, edit) {
      return must(
        await db.schema('app').rpc('panel_decide_approval', {
          p_id: id,
          p_status: decision,
          p_edited: edit ? { text: edit.text, subject: edit.subject ?? null } : null,
        }),
      ) as boolean;
    },

    async completeTouch(id, action) {
      return must(
        await db.schema('app').rpc('panel_complete_touch', { p_touch_id: id, p_action: action }),
      ) as boolean;
    },

    async listInbox({ classification, openOnly }) {
      let q = db
        .from('inbox_messages')
        .select(INBOX_COLUMNS)
        .order('received_at', { ascending: false })
        .limit(200);
      if (classification && classification !== 'all') q = q.eq('classification', classification);
      if (openOnly) q = q.eq('handled', false);
      return withCompanyNames(db, must(await q) as InboxRow[]);
    },

    async setInboxHandled(id, handled) {
      must(await db.from('inbox_messages').update({ handled }).eq('id', id));
    },

    async listPlaybooks(): Promise<PlaybookOverview[]> {
      const [playbooks, stats, enrollments] = await Promise.all([
        db
          .from('playbooks')
          .select('id, code, name, description, trigger, duration_days, active')
          .order('name'),
        db
          .from('playbook_step_stats')
          .select(
            'playbook_id, position, day_offset, channel, angle, sent, skipped, pending, replies, positive',
          )
          .order('position'),
        db.from('enrollments').select('playbook_id').eq('status', 'active').limit(5000),
      ]);
      const steps = new Map<string, PlaybookStepStat[]>();
      for (const r of must(stats) as (PlaybookStepStat & { playbook_id: string })[]) {
        const { playbook_id, ...step } = r;
        steps.set(playbook_id, [...(steps.get(playbook_id) ?? []), step]);
      }
      const active = new Map<string, number>();
      for (const e of must(enrollments) as { playbook_id: string }[])
        active.set(e.playbook_id, (active.get(e.playbook_id) ?? 0) + 1);
      return (must(playbooks) as Omit<PlaybookOverview, 'steps' | 'activeEnrollments'>[]).map(
        (p) => ({ ...p, steps: steps.get(p.id) ?? [], activeEnrollments: active.get(p.id) ?? 0 }),
      );
    },

    async salesContext(): Promise<SalesContext> {
      const [packages, settings, founder] = await Promise.all([
        db
          .from('service_packages')
          .select(
            'code, name, monthly_price_kurus, price_is_starting_from, has_payment_paths, summary, features',
          )
          .eq('active', true)
          .order('position'),
        db.from('settings').select('key, value').in('key', ['pricing', 'vat', 'sales']),
        db
          .from('founder_discount')
          .select(
            'total_slots, used_slots, setup_discount_max_pct, monthly_discount_pct, monthly_discount_months',
          )
          .maybeSingle(),
      ]);
      const byKey = new Map(
        (must(settings) as { key: string; value: unknown }[]).map((r) => [r.key, r.value]),
      );
      const f = must(founder) as {
        total_slots: number;
        used_slots: number;
        setup_discount_max_pct: number;
        monthly_discount_pct: number;
        monthly_discount_months: number;
      } | null;
      const terms: FounderTerms | null = f
        ? {
            slotsLeft: f.total_slots - f.used_slots,
            setupMaxPct: f.setup_discount_max_pct,
            setupPct: f.setup_discount_max_pct,
            monthlyPct: f.monthly_discount_pct,
            monthlyMonths: f.monthly_discount_months,
          }
        : null;
      return {
        packages: (
          must(packages) as {
            code: string;
            name: string;
            monthly_price_kurus: number | null;
            price_is_starting_from: boolean;
            has_payment_paths: boolean;
            summary: string;
            features: string[];
          }[]
        ).map((p): ServicePackageInfo => ({
          code: p.code,
          name: p.name,
          monthly_kurus: p.monthly_price_kurus === null ? null : Number(p.monthly_price_kurus),
          starting_from: p.price_is_starting_from,
          has_payment_paths: p.has_payment_paths,
          summary: p.summary,
          features: p.features,
        })),
        pricing: byKey.get('pricing') as Settings['pricing'],
        vatDefault: (byKey.get('vat') as Settings['vat'] | undefined)?.mode ?? 'unspecified',
        validDays: (byKey.get('sales') as Settings['sales'] | undefined)?.proposal_valid_days ?? 14,
        founder: terms,
      };
    },

    async listProposals() {
      const rows = must(
        await db
          .from('proposals')
          .select(PROPOSAL_SUMMARY)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as ProposalRowDb[];
      return withCompanyNames(db, rows.map(numberMonthly));
    },

    async getProposal(id) {
      const row = must(
        await db.from('proposals').select(PROPOSAL_DETAIL).eq('id', id).maybeSingle(),
      ) as (ProposalRowDb & Omit<ProposalDetail, keyof ProposalSummary | 'company_phone'>) | null;
      if (!row) return null;
      const company = must(
        await db
          .from('companies')
          .select('name, phone_e164')
          .eq('id', row.company_id)
          .maybeSingle(),
      ) as { name: string; phone_e164: string | null } | null;
      return {
        ...numberMonthly(row),
        company_name: company?.name ?? '',
        company_phone: company?.phone_e164 ?? null,
      };
    },

    async updateProposal(id, patch) {
      must(await db.from('proposals').update(patch).eq('id', id));
    },

    async createProjectProposal(p) {
      const row = must(
        await db
          .from('proposals')
          .insert({
            tenant_id: await tenant(),
            company_id: p.companyId,
            package_code: 'ozel',
            status: 'draft',
            quote: p.quote,
            vat_mode: p.vatMode,
            valid_until: p.validUntil,
            intro: p.intro,
            scope: p.scope,
          })
          .select('id')
          .single(),
      ) as { id: string };
      return row.id;
    },

    async saveProposalPdf(id, pdf) {
      const path = `${await tenant()}/${id}.pdf`;
      const up = await db.storage
        .from('proposals')
        .upload(path, new Blob([pdf.slice()], { type: 'application/pdf' }), {
          upsert: true,
          contentType: 'application/pdf',
        });
      if (up.error) throw new Error(up.error.message);
      must(await db.from('proposals').update({ pdf_path: path }).eq('id', id));
      return path;
    },

    async proposalPdfUrl(path) {
      const r = await db.storage.from('proposals').createSignedUrl(path, 7 * 86_400);
      if (r.error) throw new Error(r.error.message);
      return r.data.signedUrl;
    },

    async listDemos() {
      const rows = must(
        await db
          .from('demos')
          .select(DEMO_COLUMNS)
          .order('created_at', { ascending: false })
          .limit(200),
      ) as DemoRowDb[];
      return withCompanyNames(
        db,
        rows.map((r) => toDemo(r, apiUrl)),
      );
    },

    async upcomingMeetings() {
      const rows = must(
        await db
          .from('meetings')
          .select(MEETING_COLUMNS)
          .eq('status', 'scheduled')
          .gte('starts_at', new Date(Date.now() - 3_600_000).toISOString())
          .order('starts_at')
          .limit(20),
      ) as MeetingRowDb[];
      return withCompanyNames(db, rows.map(toMeeting));
    },

    async companySales(companyId): Promise<CompanySales> {
      const [meetings, proposals, demos, company] = await Promise.all([
        db
          .from('meetings')
          .select(MEETING_COLUMNS)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(20),
        db
          .from('proposals')
          .select(PROPOSAL_SUMMARY)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(20),
        db
          .from('demos')
          .select(DEMO_COLUMNS)
          .eq('company_id', companyId)
          .order('created_at', { ascending: false })
          .limit(5),
        db.from('companies').select('name').eq('id', companyId).maybeSingle(),
      ]);
      const name = (must(company) as { name: string } | null)?.name ?? '';
      return {
        meetings: (must(meetings) as MeetingRowDb[]).map((m) => ({
          ...toMeeting(m),
          company_name: name,
        })),
        proposals: (must(proposals) as ProposalRowDb[]).map((p) => ({
          ...numberMonthly(p),
          company_name: name,
        })),
        demos: (must(demos) as DemoRowDb[]).map((d) => ({
          ...toDemo(d, apiUrl),
          company_name: name,
        })),
      };
    },

    workerAvailable() {
      return apiUrl !== null;
    },

    async worker<T = Record<string, unknown>>(action: string, body: Record<string, unknown>) {
      if (!apiUrl) throw new Error('Sunucu adresi (VITE_API_URL) ayarlı değil.');
      const { data } = await db.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('Oturum bulunamadı; yeniden giriş yap.');
      const res = await fetch(`${apiUrl}/panel/${action}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? `İşlem başarısız (${res.status})`);
      return json as T;
    },

    async listProjects() {
      const [projects, tasks] = await Promise.all([
        db
          .from('projects')
          .select(PROJECT_LIST)
          .order('started_on', { ascending: false })
          .limit(200),
        db.from('project_tasks').select('project_id, done').limit(5000),
      ]);
      const counts = new Map<string, { done: number; total: number }>();
      for (const t of must(tasks) as { project_id: string; done: boolean }[]) {
        const c = counts.get(t.project_id) ?? { done: 0, total: 0 };
        c.total++;
        if (t.done) c.done++;
        counts.set(t.project_id, c);
      }
      const rows = (must(projects) as unknown as ProjectSummary[]).map((p) => ({
        ...p,
        tasks_done: counts.get(p.id)?.done ?? 0,
        tasks_total: counts.get(p.id)?.total ?? 0,
      }));
      return withCompanyNames(db, rows);
    },

    async getProject(id) {
      const p = must(
        await db.from('projects').select(PROJECT_LIST).eq('id', id).maybeSingle(),
      ) as Omit<
        ProjectDetail,
        'company_name' | 'tasks_done' | 'tasks_total' | 'form' | 'tasks' | 'artifacts' | 'payments'
      > | null;
      if (!p) return null;
      const [tasks, form, artifacts, payments] = await Promise.all([
        db
          .from('project_tasks')
          .select('id, title, module_code, done')
          .eq('project_id', id)
          .order('position'),
        db
          .from('setup_forms')
          .select('status, token, expires_at')
          .eq('project_id', id)
          .maybeSingle(),
        db.from('project_artifacts').select('kind, content').eq('project_id', id),
        db.from('payments').select(PAYMENT_LIST).eq('project_id', id).order('due_on'),
      ]);
      const t = must(tasks) as ProjectDetail['tasks'];
      const f = must(form) as {
        status: 'sent' | 'submitted' | 'reviewed';
        token: string;
        expires_at: string;
      } | null;
      const [named] = await withCompanyNames(db, [{ company_id: p.company_id }]);
      return {
        ...nums(p),
        company_name: named?.company_name ?? '',
        tasks: t,
        tasks_done: t.filter((x) => x.done).length,
        tasks_total: t.length,
        form: f
          ? {
              status: f.status,
              expires_at: f.expires_at,
              url: apiUrl ? `${apiUrl}/kurulum/${f.token}` : null,
            }
          : null,
        artifacts: Object.fromEntries(
          (must(artifacts) as { kind: string; content: string }[]).map((a) => [a.kind, a.content]),
        ),
        payments: (
          await withCompanyNames(db, must(payments) as Omit<PaymentItem, 'company_name'>[])
        ).map(nums),
      } as ProjectDetail;
    },

    async setTaskDone(taskId, done) {
      must(
        await db
          .from('project_tasks')
          .update({ done, done_at: done ? new Date().toISOString() : null })
          .eq('id', taskId),
      );
    },

    async updateProject(id, patch) {
      must(await db.from('projects').update(patch).eq('id', id));
    },

    async financeSummary(): Promise<FinanceSummary> {
      const monthStart = `${today().slice(0, 7)}-01`;
      const [subs, open, entries, target] = await Promise.all([
        db
          .from('subscriptions')
          .select(
            'monthly_kurus, discounted_monthly_kurus, discount_months, started_on, commitment_months, day_of_month, status',
          )
          .eq('status', 'active'),
        db.from('payments').select(PAYMENT_LIST).eq('status', 'due').order('due_on').limit(200),
        db
          .from('finance_entries')
          .select('id, kind, category, amount_kurus, occurred_on, note')
          .gte('occurred_on', monthStart)
          .order('occurred_on', { ascending: false })
          .limit(200),
        db.from('settings').select('value').eq('key', 'revenue_target').maybeSingle(),
      ]);
      const subRows = (must(subs) as SubscriptionTerms[]).map(nums);
      const entryRows = (must(entries) as FinanceEntry[]).map(nums);
      const sum = (k: 'income' | 'expense') =>
        entryRows.filter((e) => e.kind === k).reduce((n, e) => n + e.amount_kurus, 0);
      return {
        mrrKurus: mrr(subRows, today()),
        targetKurus:
          (must(target) as { value: { monthly_kurus: number | null } } | null)?.value
            .monthly_kurus ?? null,
        open: (await withCompanyNames(db, must(open) as Omit<PaymentItem, 'company_name'>[])).map(
          nums,
        ),
        monthIncomeKurus: sum('income'),
        monthExpenseKurus: sum('expense'),
        entries: entryRows,
        activeSubscriptions: subRows.length,
      };
    },

    async markPaymentPaid(id, paidOn) {
      must(await db.from('payments').update({ status: 'paid', paid_on: paidOn }).eq('id', id));
    },

    async setPaymentLink(id, link) {
      must(await db.from('payments').update({ payment_link: link }).eq('id', id));
    },

    async addFinanceEntry(e) {
      must(await db.from('finance_entries').insert({ ...e, tenant_id: await tenant() }));
    },

    async listNotes(query) {
      let q = db
        .from('notes')
        .select('id, body, tags, source, company_id, created_at')
        .order('created_at', { ascending: false })
        .limit(100);
      const s = query.replace(/[%,()]/g, ' ').trim();
      if (s.startsWith('#')) q = q.contains('tags', [s.slice(1).toLocaleLowerCase('tr')]);
      else if (s) q = q.ilike('body', `%${s}%`);
      return must(await q) as NoteItem[];
    },

    async addNote(body, tags) {
      must(
        await db.from('notes').insert({ tenant_id: await tenant(), body, tags, source: 'panel' }),
      );
    },

    // --- Phase 6 ---

    async listRoutines() {
      return must(
        await db
          .from('routines')
          .select(
            'id, code, name, action, schedule, params, enabled, source, next_run_at, last_run_at, last_result',
          )
          .order('created_at'),
      ) as RoutineItem[];
    },

    async updateRoutine(id, patch) {
      must(
        await db
          .from('routines')
          .update(patch.schedule || patch.enabled ? { ...patch, next_run_at: null } : patch)
          .eq('id', id),
      );
    },

    async listContent() {
      return must(
        await db
          .from('content_items')
          .select('id, platform, week_of, topic, body, status, posted_at')
          .neq('status', 'rejected')
          .order('week_of', { ascending: false })
          .order('platform')
          .limit(60),
      ) as ContentItem[];
    },

    async markContentPosted(id) {
      must(
        await db
          .from('content_items')
          .update({ status: 'posted', posted_at: new Date().toISOString() })
          .eq('id', id)
          .eq('status', 'approved'),
      );
    },

    async metrics(f: MetricsFilter): Promise<MetricsSummary> {
      const since = new Date(Date.now() - f.days * 86_400_000).toISOString();
      const day = new Date(Date.now() - 86_400_000).toISOString();
      const playbooks = (
        must(await db.from('playbooks').select('code').order('code')) as { code: string }[]
      ).map((p) => p.code);
      let ids: string[] | null = null;
      if (f.playbook !== 'all') {
        ids = (
          must(
            await db.from('companies').select('id').eq('assigned_playbook', f.playbook).limit(500),
          ) as { id: string }[]
        ).map((c) => c.id);
      }
      const head = { count: 'exact' as const, head: true };
      /** Company (playbook) and channel scope for the funnel queries. */
      const scoped = (table: string, cols: string, counted: boolean, channel = true) => {
        let q = db.from(table).select(cols, counted ? head : undefined);
        if (ids)
          q = q.in('company_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
        if (channel && f.channel !== 'all') q = q.eq('channel', f.channel);
        return q;
      };
      const count = async (
        q: PromiseLike<{ count: number | null; error: { message: string } | null }>,
      ) => {
        const { count: n, error } = await q;
        if (error) throw new Error(error.message);
        return n ?? 0;
      };
      const [sentRows, replyRows, positive, meetings, proposals, won, pipeline, subs] =
        await Promise.all([
          scoped('touches', 'company_id, sent_at', false)
            .eq('status', 'sent')
            .gte('sent_at', since)
            .limit(5000),
          scoped('inbox_messages', 'company_id, received_at', false)
            .neq('classification', 'auto_reply')
            .gte('received_at', since)
            .limit(5000),
          count(
            scoped('inbox_messages', 'id', true)
              .in('classification', ['interested', 'question'])
              .gte('received_at', since),
          ),
          count(
            scoped('meetings', 'id', true, false)
              .in('status', ['scheduled', 'done'])
              .gte('created_at', since),
          ),
          count(scoped('proposals', 'id', true, false).gte('sent_at', since)),
          count(
            scoped('proposals', 'id', true, false)
              .eq('status', 'accepted')
              .gte('decided_at', since),
          ),
          db.from('proposals').select('monthly_kurus, quote').in('status', ['approved', 'sent']),
          db
            .from('subscriptions')
            .select(
              'monthly_kurus, discounted_monthly_kurus, discount_months, started_on, commitment_months, day_of_month, status',
            )
            .eq('status', 'active'),
        ]);
      const [cancelled, renewals, settings, quota, queued, dead, errors, oldest] =
        await Promise.all([
          count(
            db
              .from('subscriptions')
              .select('id', head)
              .eq('status', 'cancelled')
              .gte('cancelled_on', since.slice(0, 10)),
          ),
          db
            .from('projects')
            .select('company_id, contract_end')
            .in('status', ['setup', 'active'])
            .lte('contract_end', localDate(new Date(Date.now() + 45 * 86_400_000), TZ))
            .order('contract_end')
            .limit(20),
          db
            .from('settings')
            .select('key, value')
            .in('key', ['revenue_target', 'llm', 'free_limits']),
          db
            .from('quota_usage')
            .select('provider, count')
            .eq('window_kind', 'day')
            .gte('window_start', day),
          count(db.from('jobs').select('id', head).eq('status', 'queued')),
          count(db.from('jobs').select('id', head).eq('status', 'dead')),
          count(db.from('error_events').select('id', head).gte('created_at', day)),
          db
            .from('approvals')
            .select('created_at')
            .eq('status', 'pending')
            .order('created_at')
            .limit(1)
            .maybeSingle(),
        ]);
      const usage = await usageRows(db, cfgOf(must(settings)));
      const sent = must(sentRows) as unknown as { company_id: string; sent_at: string }[];
      const replies = must(replyRows) as unknown as {
        company_id: string | null;
        received_at: string;
      }[];
      const subRows = (must(subs) as SubscriptionTerms[]).map(nums);
      const monthly = mrr(subRows, today());
      const cfg = new Map(
        (must(settings) as { key: string; value: Record<string, unknown> }[]).map((r) => [
          r.key,
          r.value,
        ]),
      );
      const quotas = (cfg.get('llm')?.quotas ?? {}) as Record<string, { rpd?: number | null }>;
      const used = new Map<string, number>();
      for (const r of must(quota) as { provider: string; count: number }[])
        used.set(r.provider, Math.max(used.get(r.provider) ?? 0, r.count));
      return {
        funnel: {
          contacted: sent.length,
          replied: replies.length,
          positive,
          meetings,
          proposals,
          won,
        },
        firstReplyHours: firstReplyHours(
          sent.map((x) => ({ company_id: x.company_id, at: x.sent_at })),
          replies
            .filter((r): r is { company_id: string; received_at: string } => !!r.company_id)
            .map((r) => ({ company_id: r.company_id, at: r.received_at })),
        ),
        mrrKurus: monthly,
        targetKurus:
          (cfg.get('revenue_target') as { monthly_kurus?: number | null } | undefined)
            ?.monthly_kurus ?? null,
        pipelineKurus: (
          must(pipeline) as {
            monthly_kurus: number | string | null;
            quote: { project?: { projectKurus?: number } } | null;
          }[]
        ).reduce(
          (n, r) =>
            n + (r.monthly_kurus ? Number(r.monthly_kurus) : (r.quote?.project?.projectKurus ?? 0)),
          0,
        ),
        clients: {
          active: subRows.length,
          avgMonthlyKurus: subRows.length ? Math.round(monthly / subRows.length) : 0,
          cancelled,
          renewals: await withCompanyNames(
            db,
            must(renewals) as { company_id: string; contract_end: string }[],
          ),
        },
        health: {
          quota: [...used].map(([bucket, n]) => ({
            bucket,
            used: n,
            rpd: quotas[bucket]?.rpd ?? null,
          })),
          queued,
          dead,
          errors24h: errors,
          oldestApprovalAt: (must(oldest) as { created_at: string } | null)?.created_at ?? null,
        },
        usage,
        playbooks,
      };
    },

    async deleteCompanyPersonalData(companyId) {
      must(await db.schema('app').rpc('delete_company_personal_data', { p_company_id: companyId }));
    },

    async mapCompanies() {
      const [rows, intel] = await Promise.all([
        db
          .from('companies')
          .select('id, name, lat, lng, score, stage, city, address, phone_e164')
          .not('lat', 'is', null)
          .not('stage', 'in', '(lost,closed)')
          .order('score', { ascending: false })
          .limit(1000),
        db.from('settings').select('value').eq('key', 'intelligence').maybeSingle(),
      ]);
      const home = (must(intel) as { value: { home?: { lat: number; lng: number } } } | null)?.value
        .home ?? { lat: 39.6484, lng: 27.8826 };
      return { companies: must(rows) as MapCompany[], home };
    },

    async today(): Promise<TodaySummary> {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const todayIso = new Date().toISOString().slice(0, 10);
      const [approvals, recent, due, quota, ready, hot] = await Promise.all([
        db
          .from('approvals')
          .select('id, kind, title, created_at, payload')
          .eq('status', 'pending')
          .order('created_at')
          .limit(30),
        db
          .from('companies')
          .select(SUMMARY_COLUMNS)
          .gte('last_analyzed_at', since)
          .order('score', { ascending: false })
          .limit(10),
        db
          .from('companies')
          .select(SUMMARY_COLUMNS)
          .eq('next_step_kind', 'waiting')
          .lte('waiting_until', todayIso)
          .order('waiting_until')
          .limit(10),
        db
          .from('quota_usage')
          .select('provider, count')
          .eq('window_kind', 'day')
          .gte('window_start', since),
        db
          .from('touches')
          .select('id, company_id, channel, recipient, body, due_at')
          .eq('status', 'ready')
          .order('due_at')
          .limit(50),
        db
          .from('inbox_messages')
          .select(INBOX_COLUMNS)
          .eq('handled', false)
          .in('classification', ['interested', 'question'])
          .order('received_at', { ascending: false })
          .limit(20),
      ]);
      const readyRows = await withCompanyNames(db, must(ready) as TouchRow[]);
      const byBucket = new Map<string, number>();
      for (const r of must(quota) as { provider: string; count: number }[])
        byBucket.set(r.provider, Math.max(byBucket.get(r.provider) ?? 0, r.count));
      return {
        pendingApprovals: await toApprovalItems(db, must(approvals) as ApprovalRow[]),
        oneClick: readyRows.filter((t) => HAND_CHANNELS.includes(t.channel)) as OneClickItem[],
        calls: readyRows.filter((t) => TASK_CHANNELS.includes(t.channel)) as OneClickItem[],
        hotReplies: await withCompanyNames(db, must(hot) as InboxRow[]),
        recentlyAnalyzed: must(recent) as CompanySummary[],
        dueWaiting: must(due) as CompanySummary[],
        quota: [...byBucket].map(([bucket, used]) => ({ bucket, used })),
      };
    },
  };
}

type SettingRow = { key: string; value: Record<string, unknown> };
const cfgOf = (rows: unknown) => rows as SettingRow[];

/** Phase 7: free-tier usage next to its limit (estimates where the provider gives no API). */
async function usageRows(
  db: SupabaseClient,
  settings: SettingRow[],
): Promise<MetricsSummary['usage']> {
  const lim = (settings.find((r) => r.key === 'free_limits')?.value ?? {}) as Record<
    string,
    number
  >;
  const tenant = must(
    await db.from('tenant_members').select('tenant_id').limit(1).maybeSingle(),
  ) as {
    tenant_id: string;
  } | null;
  if (!tenant) return [];
  const u = must(
    await db.schema('app').rpc('usage_overview', { p_tenant_id: tenant.tenant_id }),
  ) as Record<string, number>;
  const mb = (b: number) => Math.round((b / 1_048_576) * 10) / 10;
  const actions = Math.round(
    (lim.actions_scheduled_minutes ?? 0) +
      (u.heavy_runs_month ?? 0) * (lim.actions_minutes_per_run ?? 3) +
      (u.heavy_job_seconds_month ?? 0) / 60,
  );
  const workers =
    1440 +
    (u.telegram_messages_today ?? 0) +
    (u.panel_actions_today ?? 0) +
    (u.public_requests_today ?? 0) * 3;
  return [
    {
      label: 'Supabase veritabanı',
      used: mb(u.db_bytes ?? 0),
      limit: lim.db_mb ?? 500,
      unit: 'MB',
    },
    {
      label: 'Supabase dosya',
      used: mb(u.storage_bytes ?? 0),
      limit: lim.storage_mb ?? 1024,
      unit: 'MB',
    },
    {
      label: 'GitHub Actions (bu ay)',
      used: actions,
      limit: lim.actions_minutes_month ?? 2000,
      unit: 'dk',
      note: 'tahmin: zamanlanmış işler + ağır iş çalışmaları; CI dakikaları GitHub ayarlarında',
    },
    {
      label: 'Cloudflare Worker istekleri (bugün)',
      used: workers,
      limit: lim.workers_requests_day ?? 100_000,
      unit: 'istek',
      note: 'tahmin: dakikalık zamanlayıcı + Telegram + panel + herkese açık sayfalar',
    },
  ];
}

/** Adds company names with one extra query (no embedding: companies use a composite key). */
async function withCompanyNames<T extends { company_id: string | null }>(
  db: SupabaseClient,
  rows: T[],
): Promise<(T & { company_name: string })[]> {
  const ids = [...new Set(rows.map((r) => r.company_id).filter((x): x is string => !!x))];
  const names = new Map<string, string>();
  if (ids.length) {
    const res = must(await db.from('companies').select('id, name').in('id', ids)) as {
      id: string;
      name: string;
    }[];
    for (const c of res) names.set(c.id, c.name);
  }
  return rows.map((r) => ({ ...r, company_name: (r.company_id && names.get(r.company_id)) || '' }));
}

/** Pending approvals with the draft text and, for the first cold email, the word limit. */
async function toApprovalItems(db: SupabaseClient, rows: ApprovalRow[]): Promise<ApprovalItem[]> {
  const ids = rows.filter((r) => r.kind === 'outreach').map((r) => r.id);
  const cold = new Set<string>();
  let maxWords = 80;
  if (ids.length) {
    const [touches, setting] = await Promise.all([
      db.from('touches').select('approval_id').in('approval_id', ids).eq('cold', true),
      db.from('settings').select('value').eq('key', 'cold_email').maybeSingle(),
    ]);
    for (const t of must(touches) as { approval_id: string }[]) cold.add(t.approval_id);
    const v = (must(setting) as { value: { max_words?: unknown } } | null)?.value.max_words;
    if (typeof v === 'number') maxWords = v;
  }
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    title: r.title,
    created_at: r.created_at,
    text: str(r.payload.text) ?? str(r.payload.preview),
    subject: str(r.payload.subject),
    channel: str(r.payload.channel) as Channel | null,
    warnings: Array.isArray(r.payload.warnings)
      ? r.payload.warnings.filter((w): w is string => typeof w === 'string')
      : [],
    maxWords: cold.has(r.id) ? maxWords : null,
  }));
}

function numberMonthly<T extends { monthly_kurus: number | null }>(r: T): T {
  return { ...r, monthly_kurus: r.monthly_kurus === null ? null : Number(r.monthly_kurus) };
}

function toDemo(r: DemoRowDb, apiUrl: string | null): Omit<DemoSummary, 'company_name'> {
  const { token, ...rest } = r;
  return { ...rest, url: apiUrl ? `${apiUrl}/demo/${token}` : null };
}

function toMeeting(r: MeetingRowDb): Omit<MeetingSummary, 'company_name'> {
  const { notes, ...rest } = r;
  return { ...rest, summary: notes?.summary ?? null };
}

/** bigint amounts can arrive as strings; normalize to numbers. */
function nums<T>(row: T): T {
  const r = { ...(row as Record<string, unknown>) };
  for (const k of [
    'monthly_kurus',
    'setup_fee_kurus',
    'project_kurus',
    'amount_kurus',
    'discounted_monthly_kurus',
  ])
    if (typeof r[k] === 'string') r[k] = Number(r[k]);
  return r as T;
}
