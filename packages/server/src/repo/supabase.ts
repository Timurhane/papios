import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  defaultSettings,
  parseSetting,
  settingKeys,
  type Job,
  type LLMStore,
  type LlmCallRecord,
  type QueueStore,
  type FounderTerms,
  type Settings,
} from '@papi/core';
import type { DedupeKeys } from '@papi/core';
import type {
  AnalysisRecord,
  ApprovalRow,
  CompanyPatch,
  CompanyRow,
  DemoRow,
  DemoTouch,
  EmbeddingTable,
  InboxRow,
  MeetingRow,
  ProposalRow,
  ProposalStatus,
  ServicePackage,
  EnrollmentRow,
  InboxInput,
  PlaybookWithSteps,
  TouchRow,
  TouchStatus,
  KnowledgeHit,
  NewCompany,
  Repo,
  UsageSummary,
} from './types.ts';

const TOUCH_COLUMNS =
  'id, company_id, contact_id, enrollment_id, step_position, channel, recipient, subject, body, status, skip_reason, approval_id, due_at, sent_at, provider_message_id, thread_id, cold';
const STEP_COLUMNS =
  'position, day_offset, anchor, repeat_every_days, channel, angle, conditions, requires_approval, approval_exempt_kind';

const MEETING_COLUMNS =
  'id, company_id, status, proposed_slots, starts_at, duration_minutes, calendar_event_id, notes_raw, notes, source';
const PROPOSAL_COLUMNS =
  'id, company_id, meeting_id, number, status, package_code, monthly_kurus, quote, founder_discount, vat_mode, valid_until, intro, scope, approval_id, pdf_path, sent_at';
const DEMO_COLUMNS = 'id, company_id, token, status, expires_at, visits, messages';

const COMPANY_COLUMNS =
  'id, name, name_norm, domain, phone_e164, website_url, instagram_handle, maps_url, emails, city, district, address, sector, source, verified, stage, score, score_rationale, next_step_kind, assigned_playbook, waiting_reason, waiting_until, last_analyzed_at';

const vec = (v: number[]) => `[${v.join(',')}]`;

function must<T>(res: { data: T; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`${what}: ${res.error.message}`);
  return res.data;
}

const EMBED_TEXT: Record<EmbeddingTable, string> = {
  knowledge_items: 'title, content',
  memory_items: 'content',
  style_memory: 'original, revised, instruction',
};

export class SupabaseRepo implements Repo {
  private readonly db: SupabaseClient;
  private settingsCache: Settings | null = null;

  constructor(
    url: string,
    serviceKey: string,
    readonly tenantId: string,
  ) {
    this.db = createClient(url, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
  }

  private app() {
    return this.db.schema('app');
  }

  // --- settings & flags -----------------------------------------------------------------------

  async getSettings(): Promise<Settings> {
    if (this.settingsCache) return this.settingsCache;
    const rows = must(
      await this.db.from('settings').select('key, value').eq('tenant_id', this.tenantId),
      'load settings',
    ) as { key: string; value: unknown }[];
    const byKey = new Map(rows.map((r) => [r.key, r.value]));
    const merged = { ...defaultSettings } as Record<string, unknown>;
    for (const key of settingKeys) {
      if (!byKey.has(key)) continue;
      try {
        merged[key] = parseSetting(key, byKey.get(key));
      } catch (err) {
        await this.recordError('settings', 'warning', `invalid setting "${key}", using default`, {
          issue: err instanceof Error ? err.message.slice(0, 300) : String(err),
        });
      }
    }
    this.settingsCache = merged as Settings;
    return this.settingsCache;
  }

  async getFlag(key: string): Promise<boolean> {
    const res = await this.db
      .from('feature_flags')
      .select('enabled')
      .eq('tenant_id', this.tenantId)
      .eq('key', key)
      .maybeSingle();
    return Boolean(must(res, 'load flag')?.enabled);
  }

  // --- runtime state --------------------------------------------------------------------------

  async getState<T>(key: string): Promise<T | null> {
    const res = await this.db
      .from('runtime_state')
      .select('value')
      .eq('tenant_id', this.tenantId)
      .eq('key', key)
      .maybeSingle();
    return (must(res, 'get state')?.value as T | undefined) ?? null;
  }

  async setState(key: string, value: unknown): Promise<void> {
    must(
      await this.db
        .from('runtime_state')
        .upsert({ tenant_id: this.tenantId, key, value }, { onConflict: 'tenant_id,key' }),
      'set state',
    );
  }

  // --- conversation ---------------------------------------------------------------------------

  async recentConversation(channel: 'telegram', limit: number) {
    const rows = must(
      await this.db
        .from('conversation_messages')
        .select('role, content')
        .eq('tenant_id', this.tenantId)
        .eq('channel', channel)
        .order('created_at', { ascending: false })
        .limit(limit),
      'recent conversation',
    ) as { role: 'user' | 'assistant'; content: string }[];
    return rows.reverse();
  }

  async appendConversation(
    channel: 'telegram',
    role: 'user' | 'assistant',
    content: string,
    meta: Record<string, unknown> = {},
  ) {
    must(
      await this.db
        .from('conversation_messages')
        .insert({ tenant_id: this.tenantId, channel, role, content, meta }),
      'append conversation',
    );
  }

  // --- knowledge & memory ---------------------------------------------------------------------

  async searchKnowledgeByVector(embedding: number[], limit: number): Promise<KnowledgeHit[]> {
    const rows = must(
      await this.app().rpc('match_knowledge', {
        p_tenant_id: this.tenantId,
        p_embedding: vec(embedding),
        p_limit: limit,
      }),
      'match knowledge',
    ) as { id: string; kind: string; title: string; content: string; similarity: number }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      score: r.similarity,
    }));
  }

  async searchKnowledgeByText(query: string, limit: number): Promise<KnowledgeHit[]> {
    const rows = must(
      await this.app().rpc('search_knowledge_text', {
        p_tenant_id: this.tenantId,
        p_query: query,
        p_limit: limit,
      }),
      'search knowledge',
    ) as { id: string; kind: string; title: string; content: string; rank: number }[];
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      content: r.content,
      score: r.rank,
    }));
  }

  async addKnowledge(kind: string, title: string, content: string): Promise<string> {
    const row = must(
      await this.db
        .from('knowledge_items')
        .insert({ tenant_id: this.tenantId, kind, title, content })
        .select('id')
        .single(),
      'add knowledge',
    ) as { id: string };
    return row.id;
  }

  async missingEmbeddings(table: EmbeddingTable, limit: number) {
    let q = this.db
      .from(table)
      .select(`id, ${EMBED_TEXT[table]}`)
      .eq('tenant_id', this.tenantId)
      .is('embedding', null)
      .limit(limit);
    if (table === 'knowledge_items') q = q.eq('is_template', false);
    // Only public analyses are embedded: touches/replies may hold personal data (K-4.7).
    if (table === 'memory_items') q = q.eq('kind', 'analysis');
    const rows = must(await q, 'missing embeddings') as unknown as Record<string, string | null>[];
    return rows.map((r) => ({
      id: String(r.id),
      text: EMBED_TEXT[table]
        .split(', ')
        .map((c) => r[c] ?? '')
        .filter(Boolean)
        .join('\n'),
    }));
  }

  async setEmbedding(table: EmbeddingTable, id: string, embedding: number[]) {
    must(
      await this.db
        .from(table)
        .update({ embedding: vec(embedding) })
        .eq('tenant_id', this.tenantId)
        .eq('id', id),
      'set embedding',
    );
  }

  // --- approvals ------------------------------------------------------------------------------

  async listPendingApprovals(limit: number): Promise<ApprovalRow[]> {
    return must(
      await this.db
        .from('approvals')
        .select('id, kind, title, payload, status, batch_id, created_at, decided_via')
        .eq('tenant_id', this.tenantId)
        .eq('status', 'pending')
        .order('created_at')
        .limit(limit),
      'pending approvals',
    ) as ApprovalRow[];
  }

  async getApproval(id: string): Promise<ApprovalRow | null> {
    return must(
      await this.db
        .from('approvals')
        .select('id, kind, title, payload, status, batch_id, created_at, decided_via')
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .maybeSingle(),
      'get approval',
    ) as ApprovalRow | null;
  }

  async createApproval(input: {
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    batchId?: string | null;
    agent: string;
    supersedes?: string;
  }) {
    const row = must(
      await this.db
        .from('approvals')
        .insert({
          tenant_id: this.tenantId,
          kind: input.kind,
          title: input.title,
          payload: input.payload,
          batch_id: input.batchId ?? null,
          created_by_agent: input.agent,
          supersedes: input.supersedes ?? null,
        })
        .select('id')
        .single(),
      'create approval',
    ) as { id: string };
    return row.id;
  }

  async decideApproval(
    id: string,
    status: 'approved' | 'rejected' | 'needs_revision' | 'superseded',
    correction?: string,
  ) {
    const rows = must(
      await this.db
        .from('approvals')
        .update({
          status,
          decided_at: new Date().toISOString(),
          decided_via: 'telegram',
          ...(correction ? { correction } : {}),
        })
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .in('status', status === 'superseded' ? ['needs_revision'] : ['pending'])
        .select('id'),
      'decide approval',
    ) as { id: string }[];
    return rows.length > 0;
  }

  async decideBatch(batchId: string, status: 'approved' | 'rejected') {
    const rows = must(
      await this.db
        .from('approvals')
        .update({ status, decided_at: new Date().toISOString(), decided_via: 'telegram' })
        .eq('tenant_id', this.tenantId)
        .eq('batch_id', batchId)
        .eq('status', 'pending')
        .select('id'),
      'decide batch',
    ) as { id: string }[];
    return rows.map((r) => r.id);
  }

  async addStyleMemory(input: {
    draftKind: string;
    original: string;
    revised: string | null;
    instruction: string | null;
    verdict: 'approved' | 'edited' | 'rejected';
  }) {
    must(
      await this.db.from('style_memory').insert({
        tenant_id: this.tenantId,
        draft_kind: input.draftKind,
        original: input.original,
        revised: input.revised,
        instruction: input.instruction,
        verdict: input.verdict,
      }),
      'style memory',
    );
  }

  // --- jobs -----------------------------------------------------------------------------------

  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: { heavy?: boolean; runAfter?: Date; unique?: boolean; priority?: number } = {},
  ) {
    if (opts.unique) {
      const existing = must(
        await this.db
          .from('jobs')
          .select('id')
          .eq('tenant_id', this.tenantId)
          .eq('type', type)
          .in('status', ['queued', 'running'])
          .limit(1),
        'find job',
      ) as { id: string }[];
      if (existing.length > 0) return null;
    }
    const row = must(
      await this.db
        .from('jobs')
        .insert({
          tenant_id: this.tenantId,
          type,
          payload,
          heavy: opts.heavy ?? false,
          ...(opts.priority !== undefined ? { priority: opts.priority } : {}),
          ...(opts.runAfter ? { run_after: opts.runAfter.toISOString() } : {}),
        })
        .select('id')
        .single(),
      'enqueue',
    ) as { id: string };
    return row.id;
  }

  readonly queueStore: QueueStore = {
    claim: async (worker, heavy, limit) =>
      must(
        await this.app().rpc('claim_jobs', { p_worker: worker, p_heavy: heavy, p_limit: limit }),
        'claim jobs',
      ) as Job[],
    complete: async (id) => {
      must(
        await this.db
          .from('jobs')
          .update({ status: 'done', finished_at: new Date().toISOString(), locked_at: null })
          .eq('id', id),
        'complete job',
      );
    },
    retry: async (id, runAfter, error, countAttempt) => {
      const patch: Record<string, unknown> = {
        status: 'queued',
        run_after: runAfter.toISOString(),
        last_error: error,
        locked_at: null,
        locked_by: null,
      };
      if (!countAttempt) {
        const row = must(
          await this.db.from('jobs').select('attempts').eq('id', id).single(),
          'job attempts',
        ) as { attempts: number };
        patch.attempts = Math.max(0, row.attempts - 1);
      }
      must(await this.db.from('jobs').update(patch).eq('id', id), 'retry job');
    },
    dead: async (id, error) => {
      must(
        await this.db
          .from('jobs')
          .update({ status: 'dead', last_error: error, finished_at: new Date().toISOString() })
          .eq('id', id),
        'dead job',
      );
    },
  };

  // --- llm store ------------------------------------------------------------------------------

  readonly llmStore: LLMStore = {
    getCache: async (key) => {
      const row = must(
        await this.db
          .from('llm_cache')
          .select('value, expires_at')
          .eq('tenant_id', this.tenantId)
          .eq('key', key)
          .maybeSingle(),
        'cache get',
      ) as { value: unknown; expires_at: string | null } | null;
      if (!row || (row.expires_at && Date.parse(row.expires_at) < Date.now())) return undefined;
      return row.value;
    },
    setCache: async (key, value, ttlDays) => {
      must(
        await this.db.from('llm_cache').upsert(
          {
            tenant_id: this.tenantId,
            key,
            value,
            expires_at: new Date(Date.now() + ttlDays * 86_400_000).toISOString(),
          },
          { onConflict: 'tenant_id,key' },
        ),
        'cache set',
      );
    },
    consumeQuota: async (bucket, rpm, rpd, dayTimezone) =>
      Boolean(
        must(
          await this.app().rpc('consume_quota', {
            p_tenant_id: this.tenantId,
            p_provider: bucket,
            p_rpm: rpm,
            p_rpd: rpd,
            p_day_timezone: dayTimezone,
          }),
          'consume quota',
        ),
      ),
    logCall: async (r: LlmCallRecord) => {
      must(
        await this.db.from('llm_calls').insert({
          tenant_id: this.tenantId,
          agent: r.agent,
          task: r.task,
          tier: r.tier,
          provider: r.provider,
          model: r.model,
          data_class: r.dataClass,
          tokens_in: r.tokensIn,
          tokens_out: r.tokensOut,
          duration_ms: r.durationMs,
          cached: r.cached,
          status: r.status,
          error: r.error ?? null,
          prompt_id: r.promptId ?? null,
          prompt_version: r.promptVersion ?? null,
        }),
        'log llm call',
      );
    },
  };

  // --- errors & audit -------------------------------------------------------------------------

  async recordError(
    source: string,
    severity: 'warning' | 'error' | 'critical',
    message: string,
    context: Record<string, unknown> = {},
  ) {
    const res = await this.db.from('error_events').insert({
      tenant_id: this.tenantId,
      source,
      severity,
      message: message.slice(0, 2000),
      context,
    });
    if (res.error) console.error('failed to record error', res.error.message);
  }

  async audit(
    action: string,
    details: Record<string, unknown>,
    actor: { type: 'agent' | 'system'; id: string } = { type: 'system', id: 'worker' },
  ) {
    must(
      await this.db.from('audit_log').insert({
        tenant_id: this.tenantId,
        actor_type: actor.type,
        actor_id: actor.id,
        action,
        details,
      }),
      'audit',
    );
  }

  async countAuditSince(since: Date) {
    const rows = must(
      await this.db
        .from('audit_log')
        .select('action')
        .eq('tenant_id', this.tenantId)
        .gte('occurred_at', since.toISOString())
        .limit(5000),
      'audit since',
    ) as { action: string }[];
    const out: Record<string, number> = {};
    for (const r of rows) out[r.action] = (out[r.action] ?? 0) + 1;
    return out;
  }

  async usageSummary(): Promise<UsageSummary> {
    const settings = await this.getSettings();
    const since = new Date(Date.now() - 86_400_000).toISOString();
    const [quota, calls, errors, queued, dead] = await Promise.all([
      this.db
        .from('quota_usage')
        .select('provider, count, window_start')
        .eq('tenant_id', this.tenantId)
        .eq('window_kind', 'day')
        .gte('window_start', since),
      this.db
        .from('llm_calls')
        .select('cached')
        .eq('tenant_id', this.tenantId)
        .gte('created_at', since)
        .limit(10000),
      this.db
        .from('error_events')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', this.tenantId)
        .gte('created_at', since),
      this.db
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', this.tenantId)
        .eq('status', 'queued'),
      this.db
        .from('jobs')
        .select('id', { count: 'exact', head: true })
        .eq('tenant_id', this.tenantId)
        .eq('status', 'dead'),
    ]);
    const used = new Map<string, number>();
    for (const r of must(quota, 'quota usage') as {
      provider: string;
      count: number;
      window_start: string;
    }[]) {
      used.set(r.provider, Math.max(used.get(r.provider) ?? 0, r.count));
    }
    const callRows = must(calls, 'llm calls') as { cached: boolean }[];
    return {
      buckets: Object.entries(settings.llm.quotas)
        .filter(([, b]) => b.enabled)
        .map(([bucket, b]) => ({ bucket, used: used.get(bucket) ?? 0, rpd: b.rpd })),
      llmCallsToday: callRows.length,
      cachedToday: callRows.filter((c) => c.cached).length,
      errors24h: errors.count ?? 0,
      queued: queued.count ?? 0,
      dead: dead.count ?? 0,
    };
  }

  // --- CRM -----------------------------------------------------------------------------------

  async findCompany(keys: DedupeKeys): Promise<CompanyRow | null> {
    const base = () =>
      this.db.from('companies').select(COMPANY_COLUMNS).eq('tenant_id', this.tenantId).limit(1);
    const tries = [
      keys.domain ? base().eq('domain', keys.domain) : null,
      keys.phone ? base().eq('phone_e164', keys.phone) : null,
      keys.instagram ? base().eq('instagram_handle', keys.instagram) : null,
      keys.nameNorm && keys.city
        ? base().eq('name_norm', keys.nameNorm).ilike('city', keys.city)
        : null,
    ];
    for (const q of tries) {
      if (!q) continue;
      const rows = must(await q, 'find company') as unknown as CompanyRow[];
      if (rows[0]) return rows[0];
    }
    return null;
  }

  async getCompany(id: string): Promise<CompanyRow | null> {
    return must(
      await this.db
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .maybeSingle(),
      'get company',
    ) as unknown as CompanyRow | null;
  }

  async createCompany(input: NewCompany): Promise<string> {
    const row = must(
      await this.db
        .from('companies')
        .insert({
          waiting_reason: 'Analiz bekliyor',
          waiting_until: new Date().toISOString().slice(0, 10),
          ...input,
          tenant_id: this.tenantId,
        })
        .select('id')
        .single(),
      'create company',
    ) as { id: string };
    return row.id;
  }

  async updateCompany(id: string, patch: CompanyPatch) {
    must(
      await this.db.from('companies').update(patch).eq('tenant_id', this.tenantId).eq('id', id),
      'update company',
    );
  }

  async addAnalysis(a: AnalysisRecord) {
    const row = must(
      await this.db
        .from('analyses')
        .insert({
          tenant_id: this.tenantId,
          company_id: a.companyId,
          kind: a.kind,
          status: a.status,
          signals: a.signals ?? {},
          pagespeed: a.pagespeed ?? null,
          findings: a.findings,
          strongest_finding: a.strongestFinding,
          error: a.error ?? null,
        })
        .select('id')
        .single(),
      'add analysis',
    ) as { id: string };
    return row.id;
  }

  async addScore(
    companyId: string,
    s: { total: number; fit: number; pain: number; reach: number; rationale: string[] },
  ) {
    must(
      await this.db
        .from('score_history')
        .insert({ tenant_id: this.tenantId, company_id: companyId, ...s }),
      'add score',
    );
  }

  async addCompanyEvent(
    companyId: string,
    kind: string,
    summary: string,
    data: Record<string, unknown> = {},
  ) {
    must(
      await this.db
        .from('company_events')
        .insert({ tenant_id: this.tenantId, company_id: companyId, kind, summary, data }),
      'company event',
    );
  }

  async addContact(
    companyId: string,
    c: {
      full_name?: string | null;
      role?: string | null;
      email?: string | null;
      phone_e164?: string | null;
      is_decision_maker?: boolean;
      source: string;
    },
  ) {
    must(
      await this.db
        .from('contacts')
        .insert({ tenant_id: this.tenantId, company_id: companyId, ...c }),
      'add contact',
    );
  }

  async addMemory(subjectId: string, kind: 'analysis' | 'note', content: string) {
    must(
      await this.db.from('memory_items').insert({
        tenant_id: this.tenantId,
        subject_type: 'company',
        subject_id: subjectId,
        kind,
        content,
      }),
      'add memory',
    );
  }

  async activeSignals(companyId: string) {
    const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const rows = must(
      await this.db
        .from('signals')
        .select('description')
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .gte('detected_at', since)
        .limit(5),
      'signals',
    ) as { description: string }[];
    return rows.map((r) => r.description);
  }

  async companiesAwaitingAnalysis(limit: number) {
    return must(
      await this.db
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('stage', 'new')
        .order('created_at')
        .limit(limit),
      'awaiting analysis',
    ) as unknown as CompanyRow[];
  }

  async searchCompanies(query: string, limit: number) {
    const q = query.replace(/[%,()]/g, ' ').trim();
    return must(
      await this.db
        .from('companies')
        .select(COMPANY_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .or(`name.ilike.%${q}%,domain.ilike.%${q}%,instagram_handle.ilike.%${q}%`)
        .order('score', { ascending: false, nullsFirst: false })
        .limit(limit),
      'search companies',
    ) as unknown as CompanyRow[];
  }

  async countQueuedJobs(heavy: boolean) {
    const res = await this.db
      .from('jobs')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', this.tenantId)
      .eq('status', 'queued')
      .eq('heavy', heavy);
    if (res.error) throw new Error(`count jobs: ${res.error.message}`);
    return res.count ?? 0;
  }

  // --- Outreach ------------------------------------------------------------------------------

  private async playbookWhere(
    col: 'code' | 'id',
    value: string,
  ): Promise<PlaybookWithSteps | null> {
    const row = must(
      await this.db
        .from('playbooks')
        .select(`id, code, name, playbook_steps(${STEP_COLUMNS})`)
        .eq('tenant_id', this.tenantId)
        .eq(col, value)
        .maybeSingle(),
      'get playbook',
    ) as {
      id: string;
      code: string;
      name: string;
      playbook_steps: PlaybookWithSteps['steps'];
    } | null;
    if (!row) return null;
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      steps: [...row.playbook_steps].sort((a, b) => a.position - b.position),
    };
  }

  getPlaybook(code: string) {
    return this.playbookWhere('code', code);
  }

  getPlaybookById(id: string) {
    return this.playbookWhere('id', id);
  }

  async companiesToEnroll(limit: number) {
    const rows = must(
      await this.db
        .from('companies')
        .select(`${COMPANY_COLUMNS}, enrollments(id, status)`)
        .eq('tenant_id', this.tenantId)
        .eq('stage', 'analyzed')
        .eq('next_step_kind', 'playbook')
        .order('score', { ascending: false })
        .limit(limit * 3),
      'companies to enroll',
    ) as unknown as (CompanyRow & { enrollments: { status: string }[] })[];
    return rows.filter((r) => !r.enrollments.some((e) => e.status === 'active')).slice(0, limit);
  }

  async createEnrollment(companyId: string, playbookId: string, anchorDate: string | null) {
    const row = must(
      await this.db
        .from('enrollments')
        .insert({
          tenant_id: this.tenantId,
          company_id: companyId,
          playbook_id: playbookId,
          anchor_date: anchorDate,
        })
        .select('id')
        .single(),
      'create enrollment',
    ) as { id: string };
    return row.id;
  }

  async activeEnrollments(limit: number) {
    return must(
      await this.db
        .from('enrollments')
        .select('id, company_id, playbook_id, status, started_at, anchor_date, next_position')
        .eq('tenant_id', this.tenantId)
        .eq('status', 'active')
        .order('updated_at')
        .limit(limit),
      'active enrollments',
    ) as EnrollmentRow[];
  }

  async updateEnrollment(
    id: string,
    patch: Partial<Pick<EnrollmentRow, 'status' | 'next_position'>> & { stop_reason?: string },
  ) {
    must(
      await this.db.from('enrollments').update(patch).eq('tenant_id', this.tenantId).eq('id', id),
      'update enrollment',
    );
  }

  async stopEnrollments(companyId: string, reason: string) {
    const rows = must(
      await this.db
        .from('enrollments')
        .update({ status: 'stopped', stop_reason: reason })
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .eq('status', 'active')
        .select('id'),
      'stop enrollments',
    ) as { id: string }[];
    // Pending drafts of stopped sequences must not go out either.
    if (rows.length) {
      must(
        await this.db
          .from('touches')
          .update({ status: 'cancelled', skip_reason: reason })
          .eq('tenant_id', this.tenantId)
          .eq('company_id', companyId)
          .in('status', ['drafted', 'awaiting_approval', 'approved', 'scheduled', 'ready']),
        'cancel touches',
      );
    }
    return rows.length;
  }

  async createTouch(t: Partial<TouchRow> & Pick<TouchRow, 'company_id' | 'channel' | 'status'>) {
    const row = must(
      await this.db
        .from('touches')
        .insert({ ...t, tenant_id: this.tenantId })
        .select('id')
        .single(),
      'create touch',
    ) as { id: string };
    return row.id;
  }

  async updateTouch(id: string, patch: Partial<Omit<TouchRow, 'id'>>) {
    must(
      await this.db.from('touches').update(patch).eq('tenant_id', this.tenantId).eq('id', id),
      'update touch',
    );
  }

  async getTouch(id: string) {
    return must(
      await this.db
        .from('touches')
        .select(TOUCH_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .maybeSingle(),
      'get touch',
    ) as TouchRow | null;
  }

  async touchForStep(enrollmentId: string, position: number) {
    const rows = must(
      await this.db
        .from('touches')
        .select(TOUCH_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('enrollment_id', enrollmentId)
        .eq('step_position', position)
        .order('created_at', { ascending: false })
        .limit(1),
      'touch for step',
    ) as TouchRow[];
    return rows[0] ?? null;
  }

  async touchByApproval(approvalId: string) {
    return must(
      await this.db
        .from('touches')
        .select(TOUCH_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('approval_id', approvalId)
        .maybeSingle(),
      'touch by approval',
    ) as TouchRow | null;
  }

  async touchesByStatus(statuses: TouchStatus[], limit: number, dueBefore?: Date) {
    let q = this.db
      .from('touches')
      .select(TOUCH_COLUMNS)
      .eq('tenant_id', this.tenantId)
      .in('status', statuses);
    if (dueBefore) q = q.lte('due_at', dueBefore.toISOString());
    return must(
      await q.order('due_at', { ascending: true, nullsFirst: true }).limit(limit),
      'touches by status',
    ) as TouchRow[];
  }

  async findTouchForReply(threadId: string | null, from: string) {
    if (threadId) {
      const rows = must(
        await this.db
          .from('touches')
          .select(TOUCH_COLUMNS)
          .eq('tenant_id', this.tenantId)
          .eq('thread_id', threadId)
          .limit(1),
        'touch by thread',
      ) as TouchRow[];
      if (rows[0]) return rows[0];
    }
    const rows = must(
      await this.db
        .from('touches')
        .select(TOUCH_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('status', 'sent')
        .ilike('recipient', from)
        .order('sent_at', { ascending: false })
        .limit(1),
      'touch by sender',
    ) as TouchRow[];
    return rows[0] ?? null;
  }

  async emailsSentSince(since: Date) {
    const res = await this.db
      .from('touches')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', this.tenantId)
      .eq('channel', 'email')
      .eq('status', 'sent')
      .gte('sent_at', since.toISOString());
    if (res.error) throw new Error(`emails sent: ${res.error.message}`);
    return res.count ?? 0;
  }

  private async sentEmailAt(ascending: boolean) {
    const rows = must(
      await this.db
        .from('touches')
        .select('sent_at')
        .eq('tenant_id', this.tenantId)
        .eq('channel', 'email')
        .eq('status', 'sent')
        .order('sent_at', { ascending })
        .limit(1),
      'sent email at',
    ) as { sent_at: string }[];
    return rows[0]?.sent_at ?? null;
  }

  firstEmailSentAt() {
    return this.sentEmailAt(true);
  }

  lastEmailSentAt() {
    return this.sentEmailAt(false);
  }

  async sentToRecipientLast7Days(recipient: string) {
    return Number(
      must(
        await this.app().rpc('touches_last_week', {
          p_tenant_id: this.tenantId,
          p_recipient: recipient,
        }),
        'touches last week',
      ),
    );
  }

  async isSuppressed(kind: string, value: string) {
    return Boolean(
      must(
        await this.app().rpc('is_suppressed', {
          p_tenant_id: this.tenantId,
          p_kind: kind,
          p_value: value,
        }),
        'is suppressed',
      ),
    );
  }

  async suppress(
    kind: string,
    value: string,
    reason: 'unsubscribe_link' | 'asked_not_to_contact' | 'manual' | 'data_deletion',
    source: string,
  ) {
    must(
      await this.app().rpc('suppress', {
        p_tenant_id: this.tenantId,
        p_kind: kind,
        p_value: value,
        p_reason: reason,
        p_source: source,
      }),
      'suppress',
    );
  }

  async addInboxMessage(m: InboxInput) {
    const res = await this.db
      .from('inbox_messages')
      .insert({
        tenant_id: this.tenantId,
        company_id: m.companyId,
        touch_id: m.touchId,
        channel: m.channel,
        provider_message_id: m.providerMessageId,
        thread_id: m.threadId,
        from_address: m.from,
        subject: m.subject,
        body: m.body.slice(0, 20_000),
        received_at: m.receivedAt,
        classification: m.classification,
        classified_by: 'rule',
      })
      .select('id')
      .single();
    if (res.error?.code === '23505') return null; // already stored
    return (must(res, 'add inbox message') as { id: string }).id;
  }

  async toneProfile() {
    const row = must(
      await this.db
        .from('tone_profiles')
        .select('description, dos, donts, examples')
        .eq('tenant_id', this.tenantId)
        .maybeSingle(),
      'tone profile',
    ) as { description: string; dos: string[]; donts: string[]; examples: string[] } | null;
    return row ?? { description: '', dos: [], donts: [], examples: [] };
  }

  async bannedPhrases() {
    const rows = must(
      await this.db.from('banned_phrases').select('phrase').eq('tenant_id', this.tenantId),
      'banned phrases',
    ) as { phrase: string }[];
    return rows.map((r) => r.phrase);
  }

  async recentStyleCorrections(draftKind: string, limit: number) {
    return must(
      await this.db
        .from('style_memory')
        .select('original, instruction, revised')
        .eq('tenant_id', this.tenantId)
        .eq('draft_kind', draftKind)
        .neq('verdict', 'approved')
        .order('created_at', { ascending: false })
        .limit(limit),
      'style corrections',
    ) as { original: string; instruction: string | null; revised: string | null }[];
  }

  async founderSlotsAvailable() {
    const row = must(
      await this.db
        .from('founder_discount')
        .select('total_slots, used_slots')
        .eq('tenant_id', this.tenantId)
        .maybeSingle(),
      'founder slots',
    ) as { total_slots: number; used_slots: number } | null;
    return Boolean(row && row.used_slots < row.total_slots);
  }

  async latestAnalysis(companyId: string) {
    const rows = must(
      await this.db
        .from('analyses')
        .select('findings, strongest_finding')
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .neq('status', 'failed')
        .order('created_at', { ascending: false })
        .limit(1),
      'latest analysis',
    ) as { findings: string[]; strongest_finding: string | null }[];
    return rows[0] ?? null;
  }

  async primaryContact(companyId: string) {
    const rows = must(
      await this.db
        .from('contacts')
        .select('id, full_name')
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .order('is_decision_maker', { ascending: false })
        .limit(1),
      'primary contact',
    ) as { id: string; full_name: string | null }[];
    return rows[0] ?? null;
  }

  async getInboxMessage(id: string): Promise<InboxRow | null> {
    const r = must(
      await this.db
        .from('inbox_messages')
        .select(
          'id, company_id, touch_id, channel, provider_message_id, thread_id, from_address, subject, body, received_at, classification',
        )
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .maybeSingle(),
      'inbox message',
    ) as Record<string, string | null> | null;
    if (!r) return null;
    return {
      id: r.id ?? id,
      companyId: r.company_id ?? null,
      touchId: r.touch_id ?? null,
      channel: 'email',
      providerMessageId: r.provider_message_id ?? '',
      threadId: r.thread_id ?? null,
      from: r.from_address ?? '',
      subject: r.subject ?? null,
      body: r.body ?? '',
      receivedAt: r.received_at ?? '',
      classification: r.classification ?? 'unknown',
    };
  }

  // --- sales -------------------------------------------------------------------------------------

  async servicePackages(): Promise<ServicePackage[]> {
    const rows = must(
      await this.db
        .from('service_packages')
        .select(
          'code, name, monthly_price_kurus, price_is_starting_from, has_payment_paths, summary, features',
        )
        .eq('tenant_id', this.tenantId)
        .eq('active', true)
        .order('position'),
      'packages',
    ) as {
      code: string;
      name: string;
      monthly_price_kurus: number | null;
      price_is_starting_from: boolean;
      has_payment_paths: boolean;
      summary: string;
      features: string[];
    }[];
    return rows.map((r) => ({
      code: r.code,
      name: r.name,
      monthly_kurus: r.monthly_price_kurus === null ? null : Number(r.monthly_price_kurus),
      starting_from: r.price_is_starting_from,
      has_payment_paths: r.has_payment_paths,
      summary: r.summary,
      features: r.features,
    }));
  }

  async founderTerms(): Promise<FounderTerms | null> {
    const r = must(
      await this.db
        .from('founder_discount')
        .select(
          'total_slots, used_slots, setup_discount_max_pct, monthly_discount_pct, monthly_discount_months',
        )
        .eq('tenant_id', this.tenantId)
        .maybeSingle(),
      'founder terms',
    ) as {
      total_slots: number;
      used_slots: number;
      setup_discount_max_pct: number;
      monthly_discount_pct: number;
      monthly_discount_months: number;
    } | null;
    if (!r) return null;
    return {
      slotsLeft: r.total_slots - r.used_slots,
      setupMaxPct: r.setup_discount_max_pct,
      setupPct: r.setup_discount_max_pct,
      monthlyPct: r.monthly_discount_pct,
      monthlyMonths: r.monthly_discount_months,
    };
  }

  async contactNames(companyId: string) {
    const rows = must(
      await this.db
        .from('contacts')
        .select('full_name')
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId),
      'contact names',
    ) as { full_name: string | null }[];
    return rows.map((r) => r.full_name).filter((n): n is string => !!n);
  }

  async createMeeting(
    m: Partial<Omit<MeetingRow, 'id'>> & Pick<MeetingRow, 'company_id' | 'status'>,
  ) {
    return (
      must(
        await this.db
          .from('meetings')
          .insert({ ...m, tenant_id: this.tenantId })
          .select('id')
          .single(),
        'create meeting',
      ) as { id: string }
    ).id;
  }

  async updateMeeting(id: string, patch: Partial<Omit<MeetingRow, 'id' | 'company_id'>>) {
    must(
      await this.db.from('meetings').update(patch).eq('tenant_id', this.tenantId).eq('id', id),
      'update meeting',
    );
  }

  async getMeeting(id: string) {
    return must(
      await this.db
        .from('meetings')
        .select(MEETING_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('id', id)
        .maybeSingle(),
      'get meeting',
    ) as MeetingRow | null;
  }

  async latestMeeting(companyId: string) {
    const rows = must(
      await this.db
        .from('meetings')
        .select(MEETING_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .order('created_at', { ascending: false })
        .limit(1),
      'latest meeting',
    ) as MeetingRow[];
    return rows[0] ?? null;
  }

  async createProposal(
    p: Partial<Omit<ProposalRow, 'id' | 'number'>> &
      Pick<ProposalRow, 'company_id' | 'package_code' | 'valid_until' | 'status'>,
  ) {
    return must(
      await this.db
        .from('proposals')
        .insert({ ...p, tenant_id: this.tenantId })
        .select('id, number')
        .single(),
      'create proposal',
    ) as { id: string; number: string };
  }

  async updateProposal(id: string, patch: Partial<Omit<ProposalRow, 'id' | 'number'>>) {
    must(
      await this.db.from('proposals').update(patch).eq('tenant_id', this.tenantId).eq('id', id),
      'update proposal',
    );
  }

  async getProposal(id: string) {
    return this.proposalWhere('id', id);
  }

  async proposalByApproval(approvalId: string) {
    return this.proposalWhere('approval_id', approvalId);
  }

  async proposalsByStatus(statuses: ProposalStatus[], limit: number) {
    const rows = must(
      await this.db
        .from('proposals')
        .select(PROPOSAL_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .in('status', statuses)
        .order('created_at')
        .limit(limit),
      'proposals by status',
    ) as ProposalRow[];
    return rows.map((r) => ({
      ...r,
      monthly_kurus: r.monthly_kurus === null ? null : Number(r.monthly_kurus),
    }));
  }

  private async proposalWhere(column: 'id' | 'approval_id', value: string) {
    const r = must(
      await this.db
        .from('proposals')
        .select(PROPOSAL_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq(column, value)
        .maybeSingle(),
      'get proposal',
    ) as ProposalRow | null;
    return r
      ? { ...r, monthly_kurus: r.monthly_kurus === null ? null : Number(r.monthly_kurus) }
      : null;
  }

  async acceptProposal(id: string) {
    return must(
      await this.db.schema('app').rpc('accept_proposal', { p_id: id }),
      'accept proposal',
    ) as boolean;
  }

  async createDemo(d: {
    company_id: string;
    token: string;
    snapshot: Record<string, unknown>;
    expires_at: string;
  }) {
    return (
      must(
        await this.db
          .from('demos')
          .insert({ ...d, tenant_id: this.tenantId })
          .select('id')
          .single(),
        'create demo',
      ) as { id: string }
    ).id;
  }

  async activeDemo(companyId: string) {
    const rows = must(
      await this.db
        .from('demos')
        .select(DEMO_COLUMNS)
        .eq('tenant_id', this.tenantId)
        .eq('company_id', companyId)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1),
      'active demo',
    ) as DemoRow[];
    return rows[0] ?? null;
  }

  async demoTouch(token: string, kind: 'visit' | 'message', perDemo: number, total: number) {
    const rows = must(
      await this.db.schema('app').rpc('demo_touch', {
        p_token: token,
        p_kind: kind,
        p_per_demo: perDemo,
        p_total: total,
      }),
      'demo touch',
    ) as {
      result: DemoTouch['result'];
      demo_id: string | null;
      company_id: string | null;
      snapshot: Record<string, unknown> | null;
      expires_at: string | null;
    }[];
    const r = rows[0];
    return {
      result: r?.result ?? 'not_found',
      demoId: r?.demo_id ?? null,
      companyId: r?.company_id ?? null,
      snapshot: r?.snapshot ?? null,
      expiresAt: r?.expires_at ?? null,
    };
  }

  async hitRateLimit(key: string, windowSeconds: number, max: number) {
    return must(
      await this.db.schema('app').rpc('hit_rate_limit', {
        p_key: key,
        p_window_seconds: windowSeconds,
        p_max: max,
      }),
      'rate limit',
    ) as boolean;
  }

  async isMember(userId: string) {
    const rows = must(
      await this.db
        .from('tenant_members')
        .select('user_id')
        .eq('tenant_id', this.tenantId)
        .eq('user_id', userId)
        .limit(1),
      'membership',
    ) as unknown[];
    return rows.length > 0;
  }
}
