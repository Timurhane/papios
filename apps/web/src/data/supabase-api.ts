import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ApprovalItem,
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

const str = (v: unknown) => (typeof v === 'string' ? v : null);

function must<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

/** Panel data access through the user's own session: RLS (tenant + aal2) applies to every query. */
export function createSupabasePanelApi(db: SupabaseClient): PanelApi {
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
