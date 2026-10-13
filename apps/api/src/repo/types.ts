import type { LLMStore, QueueStore, Settings } from '@papi/core';

export interface KnowledgeHit {
  id: string;
  kind: string;
  title: string;
  content: string;
  score: number;
}

export interface ApprovalRow {
  id: string;
  kind: string;
  title: string;
  payload: Record<string, unknown>;
  status: string;
  batch_id: string | null;
  created_at: string;
}

export type EmbeddingTable = 'knowledge_items' | 'memory_items' | 'style_memory';

export interface UsageSummary {
  buckets: { bucket: string; used: number; rpd: number | null }[];
  llmCallsToday: number;
  cachedToday: number;
  errors24h: number;
  queued: number;
  dead: number;
}

/** Everything the Worker reads or writes, scoped to one tenant. */
export interface Repo {
  readonly tenantId: string;
  llmStore: LLMStore;
  queueStore: QueueStore;

  getSettings(): Promise<Settings>;
  getFlag(key: string): Promise<boolean>;

  getState<T>(key: string): Promise<T | null>;
  setState(key: string, value: unknown): Promise<void>;

  recentConversation(
    channel: 'telegram',
    limit: number,
  ): Promise<{ role: 'user' | 'assistant'; content: string }[]>;
  appendConversation(
    channel: 'telegram',
    role: 'user' | 'assistant',
    content: string,
    meta?: Record<string, unknown>,
  ): Promise<void>;

  searchKnowledgeByVector(embedding: number[], limit: number): Promise<KnowledgeHit[]>;
  searchKnowledgeByText(query: string, limit: number): Promise<KnowledgeHit[]>;
  addKnowledge(kind: string, title: string, content: string): Promise<string>;
  missingEmbeddings(table: EmbeddingTable, limit: number): Promise<{ id: string; text: string }[]>;
  setEmbedding(table: EmbeddingTable, id: string, embedding: number[]): Promise<void>;

  listPendingApprovals(limit: number): Promise<ApprovalRow[]>;
  getApproval(id: string): Promise<ApprovalRow | null>;
  createApproval(input: {
    kind: string;
    title: string;
    payload: Record<string, unknown>;
    batchId?: string | null;
    agent: string;
    supersedes?: string;
  }): Promise<string>;
  decideApproval(
    id: string,
    status: 'approved' | 'rejected' | 'needs_revision' | 'superseded',
    correction?: string,
  ): Promise<boolean>;
  decideBatch(batchId: string, status: 'approved' | 'rejected'): Promise<number>;
  addStyleMemory(input: {
    draftKind: string;
    original: string;
    revised: string | null;
    instruction: string | null;
    verdict: 'approved' | 'edited' | 'rejected';
  }): Promise<void>;

  enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts?: { heavy?: boolean; runAfter?: Date; unique?: boolean },
  ): Promise<string | null>;

  recordError(
    source: string,
    severity: 'warning' | 'error' | 'critical',
    message: string,
    context?: Record<string, unknown>,
  ): Promise<void>;
  audit(
    action: string,
    details: Record<string, unknown>,
    actor?: { type: 'agent' | 'system'; id: string },
  ): Promise<void>;
  countAuditSince(since: Date): Promise<Record<string, number>>;

  usageSummary(): Promise<UsageSummary>;
}
