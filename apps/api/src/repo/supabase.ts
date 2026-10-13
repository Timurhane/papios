import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  defaultSettings,
  parseSetting,
  settingKeys,
  type Job,
  type LLMStore,
  type LlmCallRecord,
  type QueueStore,
  type Settings,
} from '@papi/core';
import type { ApprovalRow, EmbeddingTable, KnowledgeHit, Repo, UsageSummary } from './types.ts';

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
        .select('id, kind, title, payload, status, batch_id, created_at')
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
        .select('id, kind, title, payload, status, batch_id, created_at')
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
    return rows.length;
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
    opts: { heavy?: boolean; runAfter?: Date; unique?: boolean } = {},
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
}
