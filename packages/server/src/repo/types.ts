import type {
  Channel,
  DedupeKeys,
  FounderDiscount,
  FounderTerms,
  LLMStore,
  PlaybookStep,
  QueueStore,
  RoutineAction,
  RoutineSchedule,
  Settings,
  SiteFeatures,
  VatMode,
} from '@papi/core';

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
  decided_via?: string | null;
}

export type EmbeddingTable = 'knowledge_items' | 'memory_items' | 'style_memory' | 'notes';

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

export type TouchStatus =
  | 'drafted'
  | 'awaiting_approval'
  | 'approved'
  | 'scheduled'
  | 'ready'
  | 'sent'
  | 'skipped'
  | 'cancelled'
  | 'failed';

export interface TouchRow {
  id: string;
  company_id: string;
  contact_id: string | null;
  enrollment_id: string | null;
  step_position: number | null;
  channel: Channel;
  recipient: string | null;
  subject: string | null;
  body: string | null;
  status: TouchStatus;
  skip_reason: string | null;
  approval_id: string | null;
  due_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  thread_id: string | null;
  cold: boolean;
}

export interface PlaybookWithSteps {
  id: string;
  code: string;
  name: string;
  steps: PlaybookStep[];
}

export interface EnrollmentRow {
  id: string;
  company_id: string;
  playbook_id: string;
  status: 'active' | 'paused' | 'stopped' | 'completed';
  started_at: string;
  anchor_date: string | null;
  next_position: number;
}

export interface InboxInput {
  companyId: string | null;
  touchId: string | null;
  channel: 'email';
  providerMessageId: string;
  threadId: string | null;
  from: string;
  subject: string | null;
  body: string;
  receivedAt: string;
  classification: string;
}

export interface ServicePackage {
  code: string;
  name: string;
  monthly_kurus: number | null;
  starting_from: boolean;
  has_payment_paths: boolean;
  summary: string;
  features: string[];
}

/** Structured meeting note, produced from the redacted text only (K-4.9). */
export interface MeetingNotes {
  summary: string;
  needs: string[];
  budget_signal: string | null;
  objections: string[];
  next_step: string | null;
  suggested_package: string | null;
}

export interface MeetingRow {
  id: string;
  company_id: string;
  status: 'proposed' | 'scheduled' | 'done' | 'cancelled' | 'no_show';
  proposed_slots: string[];
  starts_at: string | null;
  duration_minutes: number;
  calendar_event_id: string | null;
  notes_raw: string | null;
  notes: MeetingNotes | null;
  source: 'telegram_voice' | 'telegram_text' | 'panel' | null;
}

export type ProposalStatus =
  | 'draft'
  | 'awaiting_approval'
  | 'approved'
  | 'sent'
  | 'accepted'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface ProposalRow {
  id: string;
  company_id: string;
  meeting_id: string | null;
  number: string;
  status: ProposalStatus;
  package_code: string;
  monthly_kurus: number | null;
  quote: Record<string, unknown>;
  founder_discount: FounderDiscount | null;
  vat_mode: VatMode | null;
  valid_until: string;
  intro: string | null;
  scope: string[];
  approval_id: string | null;
  pdf_path: string | null;
  sent_at: string | null;
}

export interface DemoRow {
  id: string;
  company_id: string;
  token: string;
  status: 'active' | 'closed';
  expires_at: string;
  visits: number;
  messages: number;
}

export interface DemoTouch {
  result: 'ok' | 'not_found' | 'expired' | 'demo_limit' | 'total_limit';
  demoId: string | null;
  companyId: string | null;
  snapshot: Record<string, unknown> | null;
  expiresAt: string | null;
}

export interface InboxRow extends InboxInput {
  id: string;
}

export interface ProjectRow {
  id: string;
  company_id: string;
  proposal_id: string | null;
  name: string;
  package_code: string;
  payment_path: 'no_setup' | 'setup' | 'project';
  monthly_kurus: number | null;
  setup_fee_kurus: number | null;
  project_kurus: number | null;
  status: 'setup' | 'active' | 'paused' | 'ended';
  started_on: string;
  contract_end: string | null;
  satisfaction: 'positive' | 'negative' | null;
  metrics_token: string;
}

export interface SetupFormRow {
  id: string;
  project_id: string;
  token: string;
  package_code: string;
  answers: Record<string, unknown>;
  status: 'sent' | 'submitted' | 'reviewed';
  expires_at: string;
}

export interface SetupFormLookup {
  result: 'ok' | 'not_found' | 'expired' | 'submitted';
  formId: string | null;
  projectId: string | null;
  packageCode: string | null;
  businessName: string | null;
  expiresAt: string | null;
}

export interface SubscriptionRow {
  id: string;
  company_id: string;
  project_id: string | null;
  monthly_kurus: number;
  discounted_monthly_kurus: number | null;
  discount_months: number;
  started_on: string;
  commitment_months: number;
  day_of_month: number;
  status: 'active' | 'paused' | 'cancelled';
}

export interface PaymentRow {
  id: string;
  company_id: string;
  subscription_id: string | null;
  project_id: string | null;
  kind: 'setup' | 'monthly' | 'project' | 'other';
  amount_kurus: number;
  due_on: string;
  status: 'due' | 'paid' | 'cancelled';
  paid_on: string | null;
  overdue_notified_on: string | null;
}

export interface NoteRow {
  id: string;
  company_id: string | null;
  project_id: string | null;
  body: string;
  tags: string[];
  source: 'telegram_text' | 'telegram_voice' | 'panel';
  created_at: string;
}

export interface RoutineRow {
  id: string;
  code: string;
  name: string;
  schedule: RoutineSchedule;
  action: RoutineAction;
  params: Record<string, unknown>;
  enabled: boolean;
  source: 'preset' | 'telegram' | 'panel';
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: string | null;
}

export interface ContentItemRow {
  id: string;
  platform: 'linkedin' | 'x' | 'instagram';
  week_of: string;
  topic: string;
  body: string;
  status: 'awaiting_approval' | 'approved' | 'posted' | 'rejected';
  approval_id: string | null;
}

export interface SuggestionRow {
  id: string;
  kind: 'learned_rule' | 'playbook_change';
  title: string;
  detail: Record<string, unknown>;
  status: 'pending' | 'accepted' | 'rejected';
  approval_id: string | null;
}

/** What happened since a moment (night shift summary, weekly report). */
export interface ActivityCounts {
  newCompanies: number;
  analyses: number;
  approvalsCreated: number;
  signals: number;
  errors: number;
  touchesSent: number;
  replies: number;
}

/** K-16 numbers for summaries (panel computes its own through RLS). */
export interface SalesStats {
  contacted: number;
  replied: number;
  positive: number;
  meetings: number;
  proposals: number;
  won: number;
  pipelineKurus: number;
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
  decideBatch(batchId: string, status: 'approved' | 'rejected'): Promise<string[]>;
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

  // --- Outreach (Phase 3) ---
  getPlaybook(code: string): Promise<PlaybookWithSteps | null>;
  getPlaybookById(id: string): Promise<PlaybookWithSteps | null>;
  companiesToEnroll(limit: number): Promise<CompanyRow[]>;
  createEnrollment(
    companyId: string,
    playbookId: string,
    anchorDate: string | null,
  ): Promise<string>;
  activeEnrollments(limit: number): Promise<EnrollmentRow[]>;
  updateEnrollment(
    id: string,
    patch: Partial<Pick<EnrollmentRow, 'status' | 'next_position'>> & { stop_reason?: string },
  ): Promise<void>;
  stopEnrollments(companyId: string, reason: string): Promise<number>;
  createTouch(
    t: Partial<TouchRow> & Pick<TouchRow, 'company_id' | 'channel' | 'status'>,
  ): Promise<string>;
  updateTouch(id: string, patch: Partial<Omit<TouchRow, 'id'>>): Promise<void>;
  getTouch(id: string): Promise<TouchRow | null>;
  touchForStep(enrollmentId: string, position: number): Promise<TouchRow | null>;
  touchByApproval(approvalId: string): Promise<TouchRow | null>;
  touchesByStatus(statuses: TouchStatus[], limit: number, dueBefore?: Date): Promise<TouchRow[]>;
  findTouchForReply(threadId: string | null, from: string): Promise<TouchRow | null>;
  emailsSentSince(since: Date): Promise<number>;
  firstEmailSentAt(): Promise<string | null>;
  lastEmailSentAt(): Promise<string | null>;
  sentToRecipientLast7Days(recipient: string): Promise<number>;
  isSuppressed(kind: string, value: string): Promise<boolean>;
  suppress(
    kind: string,
    value: string,
    reason: 'unsubscribe_link' | 'asked_not_to_contact' | 'manual' | 'data_deletion',
    source: string,
  ): Promise<void>;
  addInboxMessage(m: InboxInput): Promise<string | null>;
  toneProfile(): Promise<{
    description: string;
    dos: string[];
    donts: string[];
    examples: string[];
  }>;
  bannedPhrases(): Promise<string[]>;
  recentStyleCorrections(
    draftKind: string,
    limit: number,
  ): Promise<{ original: string; instruction: string | null; revised: string | null }[]>;
  founderSlotsAvailable(): Promise<boolean>;
  latestAnalysis(
    companyId: string,
  ): Promise<{ findings: string[]; strongest_finding: string | null } | null>;
  primaryContact(companyId: string): Promise<{ id: string; full_name: string | null } | null>;
  getInboxMessage(id: string): Promise<InboxRow | null>;

  // --- Sales (Phase 4) ---
  servicePackages(): Promise<ServicePackage[]>;
  founderTerms(): Promise<FounderTerms | null>;
  /** Names of the company's contacts, used only to redact them (K-4.9). */
  contactNames(companyId: string): Promise<string[]>;
  createMeeting(
    m: Partial<Omit<MeetingRow, 'id'>> & Pick<MeetingRow, 'company_id' | 'status'>,
  ): Promise<string>;
  updateMeeting(id: string, patch: Partial<Omit<MeetingRow, 'id' | 'company_id'>>): Promise<void>;
  getMeeting(id: string): Promise<MeetingRow | null>;
  latestMeeting(companyId: string): Promise<MeetingRow | null>;
  createProposal(
    p: Partial<Omit<ProposalRow, 'id' | 'number'>> &
      Pick<ProposalRow, 'company_id' | 'package_code' | 'valid_until' | 'status'>,
  ): Promise<{ id: string; number: string }>;
  updateProposal(id: string, patch: Partial<Omit<ProposalRow, 'id' | 'number'>>): Promise<void>;
  getProposal(id: string): Promise<ProposalRow | null>;
  proposalByApproval(approvalId: string): Promise<ProposalRow | null>;
  proposalsByStatus(statuses: ProposalStatus[], limit: number): Promise<ProposalRow[]>;
  acceptProposal(id: string): Promise<boolean>;
  createDemo(d: {
    company_id: string;
    token: string;
    snapshot: Record<string, unknown>;
    expires_at: string;
  }): Promise<string>;
  activeDemo(companyId: string): Promise<DemoRow | null>;
  demoTouch(
    token: string,
    kind: 'visit' | 'message',
    perDemo: number,
    total: number,
  ): Promise<DemoTouch>;
  hitRateLimit(key: string, windowSeconds: number, max: number): Promise<boolean>;
  /** Panel → Worker calls: is this auth user a member of the tenant? */
  isMember(userId: string): Promise<boolean>;

  // --- Operations (Phase 5) ---
  createProject(
    p: Omit<ProjectRow, 'id' | 'satisfaction' | 'status'> & { status?: ProjectRow['status'] },
  ): Promise<string>;
  getProject(id: string): Promise<ProjectRow | null>;
  projectByProposal(proposalId: string): Promise<ProjectRow | null>;
  projectByMetricsToken(token: string): Promise<ProjectRow | null>;
  activeProjects(limit: number): Promise<ProjectRow[]>;
  updateProject(id: string, patch: Partial<Omit<ProjectRow, 'id' | 'company_id'>>): Promise<void>;
  /** Replaces the project's checklist (keeps items already ticked by title). */
  replaceProjectTasks(
    projectId: string,
    items: { title: string; module: string | null }[],
  ): Promise<void>;
  projectTasks(
    projectId: string,
  ): Promise<{ title: string; module_code: string | null; done: boolean }[]>;
  createSetupForm(f: {
    project_id: string;
    token: string;
    package_code: string;
    expires_at: string;
  }): Promise<string>;
  setupFormByProject(projectId: string): Promise<SetupFormRow | null>;
  setupFormByToken(token: string): Promise<SetupFormLookup>;
  submitSetupForm(token: string, answers: Record<string, unknown>): Promise<boolean>;
  upsertArtifact(
    projectId: string,
    kind: 'config' | 'claude_prompt' | 'checklist',
    content: string,
  ): Promise<void>;
  artifacts(projectId: string): Promise<{ kind: string; content: string }[]>;
  createSubscription(s: Omit<SubscriptionRow, 'id' | 'status'>): Promise<string>;
  activeSubscriptions(limit: number): Promise<SubscriptionRow[]>;
  /** Inserts a charge unless the same subscription already has one on that date. */
  ensurePayment(
    p: Omit<PaymentRow, 'id' | 'status' | 'paid_on' | 'overdue_notified_on'>,
  ): Promise<boolean>;
  duePayments(limit: number): Promise<PaymentRow[]>;
  markPayment(
    id: string,
    patch: Partial<Pick<PaymentRow, 'status' | 'paid_on' | 'overdue_notified_on'>>,
  ): Promise<void>;
  addNote(n: Omit<NoteRow, 'id' | 'created_at'>): Promise<string>;
  recentNotes(limit: number, query?: string): Promise<NoteRow[]>;
  upsertModuleMetrics(
    projectId: string,
    period: string,
    metrics: Record<string, number>,
  ): Promise<void>;
  moduleMetrics(projectId: string, period: string): Promise<Record<string, number> | null>;
  /** Facts used by playbook conditions (e.g. satisfaction_positive for Referans). */
  companyFacts(companyId: string): Promise<Record<string, boolean>>;
  setupContact(
    projectId: string,
  ): Promise<{ name: string | null; email: string | null; phone: string | null }>;

  // --- Intelligence & automation (Phase 6) ---
  listRoutines(): Promise<RoutineRow[]>;
  getRoutine(id: string): Promise<RoutineRow | null>;
  dueRoutines(now: Date, limit: number): Promise<RoutineRow[]>;
  createRoutine(
    r: Pick<RoutineRow, 'code' | 'name' | 'schedule' | 'action' | 'params' | 'source'> & {
      next_run_at: string;
    },
  ): Promise<string>;
  updateRoutine(id: string, patch: Partial<Omit<RoutineRow, 'id' | 'code'>>): Promise<void>;
  /** False when the same change was already recorded (fingerprint). */
  addSignal(s: {
    companyId: string;
    kind: string;
    description: string;
    fingerprint: string | null;
    sourceUrl?: string | null;
  }): Promise<boolean>;
  siteSnapshot(companyId: string): Promise<SiteFeatures | null>;
  saveSiteSnapshot(companyId: string, features: SiteFeatures): Promise<void>;
  /** Companies worth a weekly site rescan: score ≥ min, has a website, not closed; oldest snapshot first. */
  companiesForSignalScan(minScore: number, limit: number): Promise<CompanyRow[]>;
  addContentItem(c: Omit<ContentItemRow, 'id' | 'status' | 'approval_id'>): Promise<string>;
  updateContentItem(
    id: string,
    patch: Partial<Pick<ContentItemRow, 'status' | 'approval_id' | 'body'>> & {
      posted_at?: string;
    },
  ): Promise<void>;
  contentByApproval(approvalId: string): Promise<ContentItemRow | null>;
  /** Null when an identical suggestion exists already (fingerprint). */
  addSuggestion(s: {
    kind: SuggestionRow['kind'];
    title: string;
    detail: Record<string, unknown>;
    fingerprint: string;
  }): Promise<string | null>;
  updateSuggestion(
    id: string,
    patch: Partial<Pick<SuggestionRow, 'status' | 'approval_id'>>,
  ): Promise<void>;
  suggestionByApproval(approvalId: string): Promise<SuggestionRow | null>;
  /** Approval ids of content items and suggestions still waiting for a decision to be applied. */
  automationApprovalsAwaiting(limit: number): Promise<string[]>;
  /** Timurhan's correction instructions from style memory (K-6.8). */
  correctionInstructions(sinceDays: number): Promise<string[]>;
  stepStats(): Promise<
    { playbook: string; position: number; angle: string; sent: number; replies: number }[]
  >;
  addToneRule(rule: string): Promise<void>;
  activitySince(since: Date): Promise<ActivityCounts>;
  salesStats(sinceDays: number): Promise<SalesStats>;
  /** Open leads by score (hot lead digest, night shift). */
  topCompanies(minScore: number, limit: number): Promise<CompanyRow[]>;
  companiesNeedingGeocode(limit: number): Promise<CompanyRow[]>;
  setCompanyLocation(id: string, lat: number | null, lng: number | null): Promise<void>;
  geocodeCached(
    query: string,
  ): Promise<{ lat: number | null; lng: number | null; found: boolean } | null>;
  cacheGeocode(
    query: string,
    r: { lat: number | null; lng: number | null; found: boolean },
  ): Promise<void>;
  searchNotesByVector(
    embedding: number[],
    limit: number,
  ): Promise<{ id: string; body: string; created_at: string; score: number }[]>;
}
