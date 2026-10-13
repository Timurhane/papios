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

export interface TodaySummary {
  pendingApprovals: { id: string; title: string }[];
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
}
