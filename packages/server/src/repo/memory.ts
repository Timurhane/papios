import {
  defaultSettings,
  MemoryLLMStore,
  type Job,
  type QueueStore,
  type Settings,
} from '@papi/core';
import type { ApprovalRow, EmbeddingTable, KnowledgeHit, Repo, UsageSummary } from './types.ts';

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
    opts: { heavy?: boolean; unique?: boolean } = {},
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
}

function dot(a: number[], b: number[]) {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}
