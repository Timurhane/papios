import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  CompanyDetail,
  CompanySummary,
  NextStepUpdate,
  PanelApi,
  TodaySummary,
} from './types';

const SUMMARY_COLUMNS =
  'id, name, city, sector, stage, score, next_step_kind, assigned_playbook, waiting_reason, waiting_until, website_url, instagram_handle, created_at, last_analyzed_at';

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

    async today(): Promise<TodaySummary> {
      const since = new Date(Date.now() - 86_400_000).toISOString();
      const todayIso = new Date().toISOString().slice(0, 10);
      const [approvals, recent, due, quota] = await Promise.all([
        db
          .from('approvals')
          .select('id, title')
          .eq('status', 'pending')
          .order('created_at')
          .limit(20),
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
      ]);
      const byBucket = new Map<string, number>();
      for (const r of must(quota) as { provider: string; count: number }[])
        byBucket.set(r.provider, Math.max(byBucket.get(r.provider) ?? 0, r.count));
      return {
        pendingApprovals: must(approvals) as TodaySummary['pendingApprovals'],
        recentlyAnalyzed: must(recent) as CompanySummary[],
        dueWaiting: must(due) as CompanySummary[],
        quota: [...byBucket].map(([bucket, used]) => ({ bucket, used })),
      };
    },
  };
}
