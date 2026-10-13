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
}
