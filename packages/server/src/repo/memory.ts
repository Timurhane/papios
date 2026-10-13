import {
  defaultSettings,
  MemoryLLMStore,
  type DedupeKeys,
  type Job,
  type QueueStore,
  type Settings,
} from '@papi/core';
import type {
  AnalysisRecord,
  ApprovalRow,
  CompanyPatch,
  CompanyRow,
  EmbeddingTable,
  KnowledgeHit,
  NewCompany,
  Repo,
  UsageSummary,
} from './types.ts';

/** In-memory Repo for tests. Mirrors SupabaseRepo semantics closely enough to test the bot. */
export class MemoryRepo implements Repo {
  readonly tenantId = '00000000-0000-4000-8000-00000000a1a0';
  readonly llmStore = new MemoryLLMStore();
  settings: Settings = structuredClone(defaultSettings);
  flags = new Map<string, boolean>();
  state = new Map<string, unknown>();
  conversation: { role: 'user' | 'assistant'; content: string }[] = [];
  knowledge: {
    id: string;
    kind: string;
    title: string;
    content: string;
    embedding: number[] | null;
  }[] = [];
  approvals: (ApprovalRow & { correction?: string })[] = [];
  styleMemory: unknown[] = [];
  jobs: (Job & { heavy: boolean; status: string })[] = [];
  errors: { source: string; severity: string; message: string }[] = [];
  auditLog: { action: string; details: Record<string, unknown> }[] = [];
  companies: (CompanyRow & Record<string, unknown>)[] = [];
  analyses: (AnalysisRecord & { id: string })[] = [];
  scores: { companyId: string; total: number }[] = [];
  events: { companyId: string; kind: string; summary: string }[] = [];
  contacts: {
    companyId: string;
    source: string;
    full_name?: string | null;
    email?: string | null;
  }[] = [];
  memories: { subjectId: string; kind: string; content: string }[] = [];
  signalsByCompany = new Map<string, string[]>();
  private seq = 0;

  private id() {
    this.seq++;
    return `00000000-0000-4000-8000-${String(this.seq).padStart(12, '0')}`;
  }

  async getSettings() {
    return this.settings;
  }
  async getFlag(key: string) {
    return this.flags.get(key) ?? false;
  }
  async getState<T>(key: string) {
    return (this.state.get(key) as T | undefined) ?? null;
  }
  async setState(key: string, value: unknown) {
    this.state.set(key, value);
  }
  async recentConversation(_c: 'telegram', limit: number) {
    return this.conversation.slice(-limit);
  }
  async appendConversation(_c: 'telegram', role: 'user' | 'assistant', content: string) {
    this.conversation.push({ role, content });
  }
  async searchKnowledgeByVector(embedding: number[], limit: number): Promise<KnowledgeHit[]> {
    return this.knowledge
      .filter((k) => k.embedding)
      .map((k) => ({ ...k, score: dot(k.embedding ?? [], embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(({ id, kind, title, content, score }) => ({ id, kind, title, content, score }));
  }
  async searchKnowledgeByText(query: string, limit: number): Promise<KnowledgeHit[]> {
    const q = query.toLocaleLowerCase('tr');
    return this.knowledge
      .filter((k) => `${k.title} ${k.content}`.toLocaleLowerCase('tr').includes(q))
      .slice(0, limit)
      .map(({ id, kind, title, content }) => ({ id, kind, title, content, score: 1 }));
  }
  async addKnowledge(kind: string, title: string, content: string) {
    const id = this.id();
    this.knowledge.push({ id, kind, title, content, embedding: null });
    return id;
  }
  async missingEmbeddings(table: EmbeddingTable, limit: number) {
    if (table !== 'knowledge_items') return [];
    return this.knowledge
      .filter((k) => !k.embedding)
      .slice(0, limit)
      .map((k) => ({ id: k.id, text: `${k.title}\n${k.content}` }));
  }
  async setEmbedding(_t: EmbeddingTable, id: string, embedding: number[]) {
    const item = this.knowledge.find((k) => k.id === id);
    if (item) item.embedding = embedding;
  }
  async listPendingApprovals(limit: number) {
    return this.approvals.filter((a) => a.status === 'pending').slice(0, limit);
  }
  async getApproval(id: string) {
    return this.approvals.find((a) => a.id === id) ?? null;
  }
  async createApproval(input: {
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    batchId?: string | null;
    agent: string;
  }) {
    const id = this.id();
    this.approvals.push({
      id,
      kind: input.kind,
      title: input.title,
      payload: input.payload,
      status: 'pending',
      batch_id: input.batchId ?? null,
      created_at: new Date().toISOString(),
    });
    return id;
  }
  async decideApproval(
    id: string,
    status: 'approved' | 'rejected' | 'needs_revision' | 'superseded',
    correction?: string,
  ) {
    const a = this.approvals.find(
      (x) => x.id === id && x.status === (status === 'superseded' ? 'needs_revision' : 'pending'),
    );
    if (!a) return false;
    a.status = status;
    if (correction) a.correction = correction;
    return true;
  }
  async decideBatch(batchId: string, status: 'approved' | 'rejected') {
    const items = this.approvals.filter((a) => a.batch_id === batchId && a.status === 'pending');
    items.forEach((a) => (a.status = status));
    return items.length;
  }
  async addStyleMemory(input: unknown) {
    this.styleMemory.push(input);
  }
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: { heavy?: boolean; unique?: boolean; priority?: number } = {},
  ) {
    if (
      opts.unique &&
      this.jobs.some((j) => j.type === type && (j.status === 'queued' || j.status === 'running'))
    )
      return null;
    const id = this.id();
    this.jobs.push({
      id,
      tenant_id: this.tenantId,
      type,
      payload,
      attempts: 0,
      max_attempts: 5,
      heavy: opts.heavy ?? false,
      status: 'queued',
    });
    return id;
  }
  readonly queueStore: QueueStore = {
    claim: async (_w, heavy, limit) => {
      const ready = this.jobs
        .filter((j) => j.status === 'queued' && j.heavy === heavy)
        .slice(0, limit);
      ready.forEach((j) => {
        j.status = 'running';
        j.attempts++;
      });
      return ready;
    },
    complete: async (id) => this.setJob(id, 'done'),
    retry: async (id) => this.setJob(id, 'queued'),
    dead: async (id) => this.setJob(id, 'dead'),
  };
  private setJob(id: string, status: string) {
    const j = this.jobs.find((x) => x.id === id);
    if (j) j.status = status;
  }
  async recordError(source: string, severity: 'warning' | 'error' | 'critical', message: string) {
    this.errors.push({ source, severity, message });
  }
  async audit(action: string, details: Record<string, unknown>) {
    this.auditLog.push({ action, details });
  }
  async countAuditSince() {
    const out: Record<string, number> = {};
    for (const a of this.auditLog) out[a.action] = (out[a.action] ?? 0) + 1;
    return out;
  }
  async usageSummary(): Promise<UsageSummary> {
    return {
      buckets: Object.entries(this.settings.llm.quotas)
        .filter(([, b]) => b.enabled)
        .map(([bucket, b]) => ({ bucket, used: this.llmStore.used.get(bucket) ?? 0, rpd: b.rpd })),
      llmCallsToday: this.llmStore.calls.length,
      cachedToday: this.llmStore.calls.filter((c) => c.cached).length,
      errors24h: this.errors.length,
      queued: this.jobs.filter((j) => j.status === 'queued').length,
      dead: this.jobs.filter((j) => j.status === 'dead').length,
    };
  }

  // --- CRM ---
  async findCompany(k: DedupeKeys) {
    return (
      this.companies.find(
        (c) =>
          (k.domain && c.domain === k.domain) ||
          (k.phone && c.phone_e164 === k.phone) ||
          (k.instagram && c.instagram_handle === k.instagram) ||
          (k.city &&
            c.name_norm === k.nameNorm &&
            (c.city ?? '').toLocaleLowerCase('tr') === k.city),
      ) ?? null
    );
  }
  async getCompany(id: string) {
    return this.companies.find((c) => c.id === id) ?? null;
  }
  async createCompany(input: NewCompany) {
    const id = this.id();
    const for_ = (k: string) =>
      k === 'domain' || k === 'phone_e164' || k === 'instagram_handle'
        ? input[k as keyof NewCompany]
        : undefined;
    for (const key of ['domain', 'phone_e164', 'instagram_handle'] as const) {
      const v = for_(key);
      if (v && this.companies.some((c) => c[key] === v)) throw new Error(`duplicate ${key}`);
    }
    this.companies.push({
      id,
      domain: null,
      phone_e164: null,
      website_url: null,
      instagram_handle: null,
      maps_url: null,
      emails: [],
      city: null,
      district: null,
      address: null,
      sector: null,
      verified: false,
      stage: 'new',
      score: null,
      score_rationale: [],
      next_step_kind: 'waiting',
      assigned_playbook: null,
      waiting_reason: 'Analiz bekliyor',
      waiting_until: new Date().toISOString().slice(0, 10),
      last_analyzed_at: null,
      ...input,
    });
    return id;
  }
  async updateCompany(id: string, patch: CompanyPatch) {
    const c = this.companies.find((x) => x.id === id);
    if (!c) throw new Error('company not found');
    Object.assign(c, patch);
    const ok =
      (c.next_step_kind === 'playbook' && c.assigned_playbook) ||
      (c.next_step_kind === 'waiting' && c.waiting_reason && c.waiting_until) ||
      c.next_step_kind === 'closed';
    if (!ok) throw new Error('companies_next_step violated');
  }
  async addAnalysis(a: AnalysisRecord) {
    const id = this.id();
    this.analyses.push({ ...a, id });
    return id;
  }
  async addScore(companyId: string, s: { total: number }) {
    this.scores.push({ companyId, total: s.total });
  }
  async addCompanyEvent(companyId: string, kind: string, summary: string) {
    this.events.push({ companyId, kind, summary });
  }
  async addContact(
    companyId: string,
    c: { full_name?: string | null; email?: string | null; source: string },
  ) {
    this.contacts.push({ companyId, ...c });
  }
  async addMemory(subjectId: string, kind: string, content: string) {
    this.memories.push({ subjectId, kind, content });
  }
  async activeSignals(companyId: string) {
    return this.signalsByCompany.get(companyId) ?? [];
  }
  async searchCompanies(query: string, limit: number) {
    const q = query.toLocaleLowerCase('tr');
    return this.companies
      .filter((c) =>
        `${c.name} ${c.domain ?? ''} ${c.instagram_handle ?? ''}`
          .toLocaleLowerCase('tr')
          .includes(q),
      )
      .slice(0, limit);
  }
  async countQueuedJobs(heavy: boolean) {
    return this.jobs.filter((j) => j.status === 'queued' && j.heavy === heavy).length;
  }
  async companiesAwaitingAnalysis(limit: number) {
    return this.companies.filter((c) => c.stage === 'new').slice(0, limit);
  }
}

function dot(a: number[], b: number[]) {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}
