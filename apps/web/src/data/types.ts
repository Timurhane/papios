import type {
  FounderDiscount,
  FounderTerms,
  FunnelCounts,
  ProjectPart,
  RoutineAction,
  RoutineSchedule,
  RoutineSpec,
  Settings,
  VatMode,
} from '@papi/core';

export type Stage =
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

export interface CompanySummary {
  id: string;
  name: string;
  city: string | null;
  sector: string | null;
  stage: Stage;
  score: number | null;
  next_step_kind: 'playbook' | 'waiting' | 'closed';
  assigned_playbook: string | null;
  waiting_reason: string | null;
  waiting_until: string | null;
  website_url: string | null;
  instagram_handle: string | null;
  created_at: string;
  last_analyzed_at: string | null;
}

export interface PageSpeed {
  performance: number | null;
}

export interface CompanyDetail extends CompanySummary {
  domain: string | null;
  phone_e164: string | null;
  emails: string[];
  maps_url: string | null;
  address: string | null;
  source: string;
  score_fit: number | null;
  score_pain: number | null;
  score_reach: number | null;
  score_rationale: string[];
  analysis: {
    kind: string;
    status: string;
    findings: string[];
    strongest_finding: string | null;
    pagespeed: { mobile: PageSpeed | null; desktop: PageSpeed | null } | null;
    created_at: string;
  } | null;
  contacts: {
    id: string;
    full_name: string | null;
    role: string | null;
    email: string | null;
    phone_e164: string | null;
    is_decision_maker: boolean;
  }[];
  events: { id: number; occurred_at: string; kind: string; summary: string }[];
}

export type Channel =
  'email' | 'whatsapp' | 'instagram_dm' | 'linkedin' | 'x' | 'phone_call' | 'visit' | 'demo';

export type ReplyClass =
  'interested' | 'question' | 'later' | 'no' | 'do_not_contact' | 'auto_reply' | 'unknown';

export interface ApprovalItem {
  id: string;
  kind: string;
  title: string;
  created_at: string;
  text: string | null;
  subject: string | null;
  channel: Channel | null;
  warnings: string[];
  /** Word limit when this is the first cold email of a sequence (K-10.15), else null. */
  maxWords: number | null;
}

export interface ApprovalEdit {
  text: string;
  subject?: string | null;
}

/** A touch Timurhan completes by hand: one-click message, call or visit (K-10.16). */
export interface OneClickItem {
  id: string;
  company_id: string;
  company_name: string;
  channel: Channel;
  recipient: string | null;
  body: string | null;
  due_at: string | null;
}

export interface InboxItem {
  id: string;
  company_id: string | null;
  company_name: string | null;
  channel: Channel;
  from_address: string | null;
  subject: string | null;
  body: string | null;
  received_at: string;
  classification: ReplyClass | null;
  handled: boolean;
}

export interface PlaybookStepStat {
  position: number;
  day_offset: number;
  channel: Channel;
  angle: string;
  sent: number;
  skipped: number;
  pending: number;
  replies: number;
  positive: number;
}

export interface PlaybookOverview {
  id: string;
  code: string;
  name: string;
  description: string;
  trigger: string;
  duration_days: number | null;
  active: boolean;
  activeEnrollments: number;
  steps: PlaybookStepStat[];
}

export interface TodaySummary {
  pendingApprovals: ApprovalItem[];
  oneClick: OneClickItem[];
  calls: OneClickItem[];
  hotReplies: InboxItem[];
  recentlyAnalyzed: CompanySummary[];
  dueWaiting: CompanySummary[];
  quota: { bucket: string; used: number }[];
}

export type NextStepUpdate =
  | { kind: 'waiting'; reason: string; until: string }
  | { kind: 'closed' }
  | { kind: 'playbook'; playbook: 'soguk_ana' | 'hafif_soguk' };

export interface ServicePackageInfo {
  code: string;
  name: string;
  monthly_kurus: number | null;
  starting_from: boolean;
  has_payment_paths: boolean;
  summary: string;
  features: string[];
}

export interface SalesContext {
  packages: ServicePackageInfo[];
  pricing: Settings['pricing'];
  founder: FounderTerms | null;
  vatDefault: Settings['vat']['mode'];
  validDays: number;
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

export interface ProposalSummary {
  id: string;
  number: string;
  status: ProposalStatus;
  company_id: string;
  company_name: string;
  package_code: string;
  monthly_kurus: number | null;
  valid_until: string;
  created_at: string;
}

export interface ProposalDetail extends ProposalSummary {
  quote: Record<string, unknown>;
  founder_discount: FounderDiscount | null;
  vat_mode: VatMode | null;
  intro: string | null;
  scope: string[];
  pdf_path: string | null;
  sent_at: string | null;
  approval_id: string | null;
  company_phone: string | null;
}

export interface ProposalPatch {
  intro?: string;
  scope?: string[];
  vat_mode?: VatMode;
  founder_discount?: FounderDiscount | null;
  quote?: Record<string, unknown>;
  monthly_kurus?: number;
}

export interface NewProjectProposal {
  companyId: string;
  parts: ProjectPart[];
  intro: string;
  scope: string[];
  vatMode: VatMode;
  quote: Record<string, unknown>;
  validUntil: string;
}

export interface DemoSummary {
  id: string;
  company_id: string;
  company_name: string;
  url: string | null;
  status: 'active' | 'closed';
  expires_at: string;
  visits: number;
  messages: number;
}

export interface MeetingSummary {
  id: string;
  company_id: string;
  company_name: string;
  status: 'proposed' | 'scheduled' | 'done' | 'cancelled' | 'no_show';
  starts_at: string | null;
  summary: string | null;
}

export interface CompanySales {
  meetings: MeetingSummary[];
  proposals: ProposalSummary[];
  demos: DemoSummary[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  company_id: string;
  package_code: string;
  status: 'setup' | 'active' | 'paused' | 'ended';
  started_on: string;
  contract_end: string | null;
  tasks_done: number;
  tasks_total: number;
}

export interface PaymentItem {
  id: string;
  company_id: string;
  company_name: string;
  kind: 'setup' | 'monthly' | 'project' | 'other';
  amount_kurus: number;
  due_on: string;
  status: 'due' | 'paid' | 'cancelled';
  paid_on: string | null;
  payment_link: string | null;
}

export interface ProjectDetail extends ProjectSummary {
  company_name: string;
  payment_path: 'no_setup' | 'setup' | 'project';
  monthly_kurus: number | null;
  setup_fee_kurus: number | null;
  project_kurus: number | null;
  satisfaction: 'positive' | 'negative' | null;
  form: {
    status: 'sent' | 'submitted' | 'reviewed';
    url: string | null;
    expires_at: string;
  } | null;
  tasks: { id: string; title: string; module_code: string | null; done: boolean }[];
  artifacts: Partial<Record<'config' | 'claude_prompt' | 'checklist', string>>;
  payments: PaymentItem[];
}

export interface FinanceEntry {
  id: string;
  kind: 'income' | 'expense';
  category: string;
  amount_kurus: number;
  occurred_on: string;
  note: string | null;
}

export interface FinanceSummary {
  mrrKurus: number;
  targetKurus: number | null;
  open: PaymentItem[];
  monthIncomeKurus: number;
  monthExpenseKurus: number;
  entries: FinanceEntry[];
  activeSubscriptions: number;
}

export interface NoteItem {
  id: string;
  body: string;
  tags: string[];
  source: 'telegram_text' | 'telegram_voice' | 'panel';
  company_id: string | null;
  created_at: string;
}

/** Server-side actions on the Worker (apps/api/src/panel-api.ts). */
export type WorkerAction =
  | 'proposal.draft'
  | 'proposal.vat'
  | 'proposal.submit'
  | 'proposal.sent'
  | 'proposal.close'
  | 'meeting.propose'
  | 'meeting.schedule'
  | 'meeting.note'
  | 'meeting.brief'
  | 'demo.create'
  | 'routine.parse'
  | 'routine.save'
  | 'voice.start'
  | 'voice.tool'
  | 'voice.end';

// --- Phase 6 ---

export interface RoutineItem {
  id: string;
  code: string;
  name: string;
  action: RoutineAction;
  schedule: RoutineSchedule;
  params: Record<string, unknown>;
  enabled: boolean;
  source: 'preset' | 'telegram' | 'panel';
  next_run_at: string | null;
  last_run_at: string | null;
  last_result: string | null;
}

export interface RoutineParseResult {
  spec: RoutineSpec | null;
  description?: string;
}

export interface ContentItem {
  id: string;
  platform: 'linkedin' | 'x' | 'instagram';
  week_of: string;
  topic: string;
  body: string;
  status: 'awaiting_approval' | 'approved' | 'posted' | 'rejected';
  posted_at: string | null;
}

export interface MetricsFilter {
  days: number;
  playbook: string | 'all';
  channel: Channel | 'all';
}

export interface MetricsSummary {
  funnel: FunnelCounts;
  /** Median hours from the first sent touch to the first reply, per company in the period. */
  firstReplyHours: number | null;
  mrrKurus: number;
  targetKurus: number | null;
  pipelineKurus: number;
  clients: {
    active: number;
    avgMonthlyKurus: number;
    cancelled: number;
    renewals: { company_name: string; contract_end: string }[];
  };
  health: {
    quota: { bucket: string; used: number; rpd: number | null }[];
    queued: number;
    dead: number;
    errors24h: number;
    oldestApprovalAt: string | null;
  };
  playbooks: string[];
}

export interface MapCompany {
  id: string;
  name: string;
  lat: number;
  lng: number;
  score: number | null;
  stage: Stage;
  city: string | null;
  address: string | null;
  phone_e164: string | null;
}

/** Data access used by the panel. Supabase-backed in the app, faked in tests. */
export interface PanelApi {
  listCompanies(filter: { search?: string; stage?: Stage | 'all' }): Promise<CompanySummary[]>;
  getCompany(id: string): Promise<CompanyDetail | null>;
  setNextStep(id: string, step: NextStepUpdate): Promise<void>;
  queueCsvImport(rows: Record<string, string>[]): Promise<void>;
  today(): Promise<TodaySummary>;
  /** Panel approval; the Worker then schedules the touch (or cancels it). False if no longer pending. */
  decideApproval(
    id: string,
    decision: 'approved' | 'rejected',
    edit?: ApprovalEdit,
  ): Promise<boolean>;
  /** "Gönderdim / Aradım" or "Atla" for a ready one-click item. False if it was not ready. */
  completeTouch(id: string, action: 'sent' | 'skip'): Promise<boolean>;
  listInbox(filter: {
    classification?: ReplyClass | 'all';
    openOnly?: boolean;
  }): Promise<InboxItem[]>;
  setInboxHandled(id: string, handled: boolean): Promise<void>;
  listPlaybooks(): Promise<PlaybookOverview[]>;

  // --- Sales (Phase 4) ---
  salesContext(): Promise<SalesContext>;
  listProposals(): Promise<ProposalSummary[]>;
  getProposal(id: string): Promise<ProposalDetail | null>;
  updateProposal(id: string, patch: ProposalPatch): Promise<void>;
  createProjectProposal(p: NewProjectProposal): Promise<string>;
  /** Uploads the browser-made PDF (K-13.12) and stores its path on the proposal. */
  saveProposalPdf(id: string, pdf: Uint8Array): Promise<string>;
  /** Time-limited link to a stored PDF. */
  proposalPdfUrl(path: string): Promise<string>;
  listDemos(): Promise<DemoSummary[]>;
  upcomingMeetings(): Promise<MeetingSummary[]>;
  companySales(companyId: string): Promise<CompanySales>;
  /** True when the Worker URL is configured (actions below are available). */
  workerAvailable(): boolean;
  worker<T = Record<string, unknown>>(
    action: WorkerAction,
    body: Record<string, unknown>,
  ): Promise<T>;

  // --- Operations (Phase 5) ---
  listProjects(): Promise<(ProjectSummary & { company_name: string })[]>;
  getProject(id: string): Promise<ProjectDetail | null>;
  setTaskDone(taskId: string, done: boolean): Promise<void>;
  updateProject(
    id: string,
    patch: Partial<Pick<ProjectDetail, 'status' | 'satisfaction'>>,
  ): Promise<void>;
  financeSummary(): Promise<FinanceSummary>;
  markPaymentPaid(id: string, paidOn: string): Promise<void>;
  setPaymentLink(id: string, link: string | null): Promise<void>;
  addFinanceEntry(e: Omit<FinanceEntry, 'id'>): Promise<void>;
  listNotes(query: string): Promise<NoteItem[]>;
  addNote(body: string, tags: string[]): Promise<void>;

  // --- Intelligence and automation (Phase 6) ---
  listRoutines(): Promise<RoutineItem[]>;
  /** A schedule change clears next_run_at; the Worker's tick schedules the next run. */
  updateRoutine(
    id: string,
    patch: Partial<Pick<RoutineItem, 'enabled' | 'schedule'>>,
  ): Promise<void>;
  listContent(): Promise<ContentItem[]>;
  markContentPosted(id: string): Promise<void>;
  metrics(filter: MetricsFilter): Promise<MetricsSummary>;
  mapCompanies(): Promise<{ companies: MapCompany[]; home: { lat: number; lng: number } }>;
}
