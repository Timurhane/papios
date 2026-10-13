import type { DedupeKeys, LLMStore, QueueStore, Settings } from '@papi/core';

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

export type CompanyStage =
  | 'new'
  | 'analyzing'
  | 'analyzed'
  | 'waitlist'
  | 'in_playbook'
  | 'replied'
  | 'meeting'
  | 'proposal'
  | 'won'
  | 'lost'
  | 'closed';

export type CompanySource =
  'telegram' | 'csv' | 'osm' | 'grounding' | 'instagram' | 'analysis_tool' | 'manual' | 'places';

export interface CompanyRow {
  id: string;
  name: string;
  name_norm: string;
  domain: string | null;
  phone_e164: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  maps_url: string | null;
  emails: string[];
  city: string | null;
  district: string | null;
  address: string | null;
  sector: string | null;
  source: CompanySource;
  verified: boolean;
  stage: CompanyStage;
  score: number | null;
  score_rationale: string[];
  next_step_kind: 'playbook' | 'waiting' | 'closed';
  assigned_playbook: string | null;
  waiting_reason: string | null;
  waiting_until: string | null;
  last_analyzed_at: string | null;
}

export type NewCompany = Partial<Omit<CompanyRow, 'id'>> &
  Pick<CompanyRow, 'name' | 'name_norm' | 'source'>;

export interface CompanyPatch extends Partial<Omit<CompanyRow, 'id' | 'source'>> {
  sector_source?: 'rule' | 'model' | 'manual' | 'source' | null;
  score_fit?: number;
  score_pain?: number;
  score_reach?: number;
  lat?: number | null;
  lng?: number | null;
}

export interface AnalysisRecord {
  companyId: string;
  kind: 'light' | 'deep';
  status: 'ok' | 'partial' | 'failed';
  signals: unknown;
  pagespeed: unknown;
  findings: string[];
  strongestFinding: string | null;
  error?: string | null;
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
    opts?: { heavy?: boolean; runAfter?: Date; unique?: boolean; priority?: number },
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

  // --- CRM (Phase 2) ---
  findCompany(keys: DedupeKeys): Promise<CompanyRow | null>;
  getCompany(id: string): Promise<CompanyRow | null>;
  createCompany(input: NewCompany): Promise<string>;
  updateCompany(id: string, patch: CompanyPatch): Promise<void>;
  addAnalysis(a: AnalysisRecord): Promise<string>;
  addScore(
    companyId: string,
    s: { total: number; fit: number; pain: number; reach: number; rationale: string[] },
  ): Promise<void>;
  addCompanyEvent(
    companyId: string,
    kind: string,
    summary: string,
    data?: Record<string, unknown>,
  ): Promise<void>;
  addContact(
    companyId: string,
    c: {
      full_name?: string | null;
      role?: string | null;
      email?: string | null;
      phone_e164?: string | null;
      is_decision_maker?: boolean;
      source: string;
    },
  ): Promise<void>;
  addMemory(subjectId: string, kind: 'analysis' | 'note', content: string): Promise<void>;
  activeSignals(companyId: string): Promise<string[]>;
  companiesAwaitingAnalysis(limit: number): Promise<CompanyRow[]>;
  searchCompanies(query: string, limit: number): Promise<CompanyRow[]>;
  countQueuedJobs(heavy: boolean): Promise<number>;
}
