import { defaultSettings, quotePaths } from '@papi/core';
import type {
  ContentItem,
  MapCompany,
  MetricsFilter,
  MetricsSummary,
  RoutineItem,
  FinanceEntry,
  NoteItem,
  PaymentItem,
  ProjectDetail,
  ApprovalEdit,
  CompanySales,
  DemoSummary,
  MeetingSummary,
  NewProjectProposal,
  ProposalDetail,
  ProposalPatch,
  SalesContext,
  WorkerAction,
  ApprovalItem,
  CompanyDetail,
  CompanySummary,
  InboxItem,
  NextStepUpdate,
  OneClickItem,
  PanelApi,
  PlaybookOverview,
  ReplyClass,
} from '@/data/types';

export const company = (over: Partial<CompanyDetail> = {}): CompanyDetail => ({
  id: 'c1',
  name: 'Örnek Diş Kliniği',
  city: 'Balıkesir',
  sector: 'Klinik / sağlık',
  stage: 'analyzed',
  score: 78,
  next_step_kind: 'playbook',
  assigned_playbook: 'soguk_ana',
  waiting_reason: null,
  waiting_until: null,
  website_url: 'https://ornekdis.com/',
  instagram_handle: 'ornekdis',
  created_at: '2026-10-13T08:00:00Z',
  last_analyzed_at: '2026-10-13T08:01:00Z',
  domain: 'ornekdis.com',
  phone_e164: '902661234567',
  emails: ['info@ornekdis.com'],
  maps_url: null,
  address: null,
  source: 'telegram',
  score_fit: 34,
  score_pain: 30,
  score_reach: 14,
  score_rationale: [
    'Uygunluk +22: Klinik / sağlık: müşteri başı değeri yüksek sektör',
    'Dert +8: Mobil hız düşük (35/100)',
  ],
  analysis: {
    kind: 'light',
    status: 'ok',
    findings: ['Randevular telefonla alınıyor olabilir.'],
    strongest_finding: 'Mobil site yavaş olduğu için randevu talepleri kaçıyor olabilir.',
    pagespeed: { mobile: { performance: 35 }, desktop: { performance: 80 } },
    created_at: '2026-10-13T08:01:00Z',
  },
  contacts: [
    {
      id: 'p1',
      full_name: 'Uzm. Dr. Ayşe Yılmaz',
      role: null,
      email: null,
      phone_e164: null,
      is_decision_maker: true,
    },
  ],
  events: [
    {
      id: 1,
      occurred_at: '2026-10-13T08:01:00Z',
      kind: 'analyzed',
      summary: 'Puan 78 → Soğuk Ana',
    },
  ],
  ...over,
});

export class FakePanelApi implements PanelApi {
  companies: CompanyDetail[] = [
    company(),
    company({
      id: 'c2',
      name: 'Yılmaz Emlak',
      score: 42,
      stage: 'waitlist',
      next_step_kind: 'waiting',
      assigned_playbook: null,
      waiting_reason: 'Puan eşiğin altında',
      waiting_until: '2027-01-11',
      city: 'Bursa',
      sector: 'Emlak',
    }),
  ];
  approvals: ApprovalItem[] = [
    {
      id: 'a1',
      kind: 'outreach',
      title: 'E-posta: Örnek Diş Kliniği (Soğuk Ana 1. adım)',
      created_at: '2026-10-13T08:02:00Z',
      text: 'Merhaba Ayşe Hanım,\n\nMobil siteniz yavaş açılıyor.\n\nTimurhan',
      subject: 'Mobil siteniz hakkında',
      channel: 'email',
      warnings: [],
      maxWords: 80,
    },
  ];
  decisions: { id: string; decision: string; edit?: ApprovalEdit }[] = [];
  ready: OneClickItem[] = [
    {
      id: 't1',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      channel: 'whatsapp',
      recipient: '905321112233',
      body: 'Merhaba, mail attım; bakabildiniz mi?',
      due_at: '2026-10-13T07:00:00Z',
    },
    {
      id: 't2',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      channel: 'phone_call',
      recipient: '902661234567',
      body: 'Kısa tanışma araması',
      due_at: '2026-10-13T07:00:00Z',
    },
  ];
  completions: { id: string; action: string }[] = [];
  inbox: InboxItem[] = [
    {
      id: 'm1',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      channel: 'email',
      from_address: 'ayse@ornekdis.com',
      subject: 'Re: Mobil siteniz hakkında',
      body: 'Merhaba, ilgimi çekti. Fiyat nedir?',
      received_at: '2026-10-13T09:00:00Z',
      classification: 'question',
      handled: false,
    },
    {
      id: 'm2',
      company_id: 'c2',
      company_name: 'Yılmaz Emlak',
      channel: 'email',
      from_address: 'info@yilmazemlak.com',
      subject: 'Ofis dışında',
      body: 'Ofis dışındayım.',
      received_at: '2026-10-12T09:00:00Z',
      classification: 'auto_reply',
      handled: false,
    },
  ];
  playbooks: PlaybookOverview[] = [
    {
      id: 'pb1',
      code: 'soguk_ana',
      name: 'Soğuk Ana',
      description: '70+ puanlı adaylar için 8 adımlı dizi.',
      trigger: 'Puan 70 ve üzeri',
      duration_days: 30,
      active: true,
      activeEnrollments: 3,
      steps: [
        {
          position: 1,
          day_offset: 0,
          channel: 'email',
          angle: 'En güçlü bulgu',
          sent: 10,
          skipped: 0,
          pending: 2,
          replies: 2,
          positive: 1,
        },
        {
          position: 2,
          day_offset: 2,
          channel: 'whatsapp',
          angle: 'Kısa hatırlatma',
          sent: 0,
          skipped: 0,
          pending: 0,
          replies: 0,
          positive: 0,
        },
      ],
    },
  ];
  imports: Record<string, string>[][] = [];
  steps: { id: string; step: NextStepUpdate }[] = [];

  async listCompanies({
    search,
    stage,
  }: {
    search?: string;
    stage?: string;
  }): Promise<CompanySummary[]> {
    return this.companies.filter(
      (c) =>
        (!stage || stage === 'all' || c.stage === stage) &&
        (!search || c.name.toLocaleLowerCase('tr').includes(search.toLocaleLowerCase('tr'))),
    );
  }
  async getCompany(id: string) {
    return this.companies.find((c) => c.id === id) ?? null;
  }
  async setNextStep(id: string, step: NextStepUpdate) {
    this.steps.push({ id, step });
    const c = this.companies.find((x) => x.id === id);
    if (c && step.kind === 'waiting')
      Object.assign(c, {
        next_step_kind: 'waiting',
        waiting_reason: step.reason,
        waiting_until: step.until,
        stage: 'waitlist',
      });
    if (c && step.kind === 'closed')
      Object.assign(c, { next_step_kind: 'closed', stage: 'closed' });
  }
  async queueCsvImport(rows: Record<string, string>[]) {
    this.imports.push(rows);
  }
  async today() {
    return {
      pendingApprovals: this.approvals,
      oneClick: this.ready.filter((t) => t.channel !== 'phone_call' && t.channel !== 'visit'),
      calls: this.ready.filter((t) => t.channel === 'phone_call' || t.channel === 'visit'),
      hotReplies: this.inbox.filter(
        (m) => !m.handled && (m.classification === 'interested' || m.classification === 'question'),
      ),
      recentlyAnalyzed: this.companies.slice(0, 1),
      dueWaiting: [],
      quota: [{ bucket: 'gemini', used: 12 }],
    };
  }
  async decideApproval(id: string, decision: 'approved' | 'rejected', edit?: ApprovalEdit) {
    const before = this.approvals.length;
    this.approvals = this.approvals.filter((a) => a.id !== id);
    if (this.approvals.length === before) return false;
    this.decisions.push({ id, decision, ...(edit ? { edit } : {}) });
    return true;
  }
  async completeTouch(id: string, action: 'sent' | 'skip') {
    const before = this.ready.length;
    this.ready = this.ready.filter((t) => t.id !== id);
    if (this.ready.length === before) return false;
    this.completions.push({ id, action });
    return true;
  }
  async listInbox({
    classification,
    openOnly,
  }: {
    classification?: ReplyClass | 'all';
    openOnly?: boolean;
  }) {
    return this.inbox.filter(
      (m) =>
        (!classification || classification === 'all' || m.classification === classification) &&
        (!openOnly || !m.handled),
    );
  }
  async setInboxHandled(id: string, handled: boolean) {
    const m = this.inbox.find((x) => x.id === id);
    if (m) m.handled = handled;
  }
  async listPlaybooks() {
    return this.playbooks;
  }

  // --- sales ---
  context: SalesContext = {
    packages: [
      {
        code: 'refleks',
        name: 'Refleks',
        monthly_kurus: 1_750_000,
        starting_from: false,
        has_payment_paths: true,
        summary: 'Gelen her mesaja anında cevap ve takip.',
        features: ['Anında cevap'],
      },
      {
        code: 'sistem',
        name: 'Sistem',
        monthly_kurus: 2_550_000,
        starting_from: false,
        has_payment_paths: true,
        summary: "Refleks'in tamamı + satış, randevu ve yorum otomasyonları.",
        features: ['Teklif takibi'],
      },
      {
        code: 'ozel',
        name: 'Özel',
        monthly_kurus: null,
        starting_from: true,
        has_payment_paths: false,
        summary: 'Pakete sığmayan işler.',
        features: [],
      },
    ],
    pricing: {
      ...defaultSettings.pricing,
      custom_project: {
        ...defaultSettings.pricing.custom_project,
        daily_rate_kurus: 1_000_000,
        uncertainty_pct: 20,
      },
    },
    founder: { slotsLeft: 2, setupMaxPct: 40, setupPct: 40, monthlyPct: 20, monthlyMonths: 3 },
    vatDefault: 'unspecified',
    validDays: 14,
  };
  proposals: ProposalDetail[] = [
    {
      id: 'p1',
      number: 'AJNA-2026-0001',
      status: 'draft',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      package_code: 'sistem',
      monthly_kurus: 2_550_000,
      valid_until: '2026-10-27',
      created_at: '2026-10-13T09:00:00Z',
      quote: {
        kind: 'paths',
        ...quotePaths(2_550_000, defaultSettings.pricing, {
          setupPct: 40,
          monthlyPct: 20,
          monthlyMonths: 3,
        }),
      },
      founder_discount: { setupPct: 40, monthlyPct: 20, monthlyMonths: 3 },
      vat_mode: null,
      intro: 'Gece gelen mesajlar sabaha kalmasın.',
      scope: ['Instagram mesajlarına anında cevap'],
      pdf_path: null,
      sent_at: null,
      approval_id: null,
      company_phone: '902661234567',
    },
  ];
  pdfs: { id: string; size: number }[] = [];
  demos: DemoSummary[] = [
    {
      id: 'd1',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      url: 'https://api.test/demo/abc',
      status: 'active',
      expires_at: '2026-10-27T09:00:00Z',
      visits: 3,
      messages: 5,
    },
  ];
  meetings: MeetingSummary[] = [
    {
      id: 'mt1',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      status: 'scheduled',
      starts_at: '2026-10-15T11:00:00Z',
      summary: null,
    },
  ];
  workerCalls: { action: WorkerAction; body: Record<string, unknown> }[] = [];
  workerReplies: Partial<Record<WorkerAction, Record<string, unknown>>> = {};
  hasWorker = true;

  async salesContext() {
    return this.context;
  }
  async listProposals() {
    return this.proposals;
  }
  async getProposal(id: string) {
    return this.proposals.find((p) => p.id === id) ?? null;
  }
  async updateProposal(id: string, patch: ProposalPatch) {
    const p = this.proposals.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async createProjectProposal(p: NewProjectProposal) {
    const id = `p${this.proposals.length + 1}`;
    const [template] = this.proposals;
    if (!template) throw new Error('fake needs a template proposal');
    this.proposals.push({
      ...template,
      id,
      number: `AJNA-2026-000${this.proposals.length + 1}`,
      company_id: p.companyId,
      package_code: 'ozel',
      monthly_kurus: null,
      quote: p.quote,
      founder_discount: null,
      vat_mode: p.vatMode,
      intro: p.intro,
      scope: p.scope,
      valid_until: p.validUntil,
    });
    return id;
  }
  async saveProposalPdf(id: string, pdf: Uint8Array) {
    this.pdfs.push({ id, size: pdf.length });
    const p = this.proposals.find((x) => x.id === id);
    if (p) p.pdf_path = `t/${id}.pdf`;
    return `t/${id}.pdf`;
  }
  async proposalPdfUrl(path: string) {
    return `https://storage.test/${path}?token=x`;
  }
  async listDemos() {
    return this.demos;
  }
  async upcomingMeetings() {
    return this.meetings.filter((m) => m.status === 'scheduled');
  }
  async companySales(companyId: string): Promise<CompanySales> {
    return {
      meetings: this.meetings.filter((m) => m.company_id === companyId),
      proposals: this.proposals.filter((p) => p.company_id === companyId),
      demos: this.demos.filter((d) => d.company_id === companyId),
    };
  }
  workerAvailable() {
    return this.hasWorker;
  }
  async worker<T = Record<string, unknown>>(action: WorkerAction, body: Record<string, unknown>) {
    this.workerCalls.push({ action, body });
    const p = this.proposals.find((x) => x.id === body.proposalId);
    if (action === 'proposal.vat' && p) {
      p.vat_mode = body.mode as 'included' | 'excluded';
      p.status = 'awaiting_approval';
    }
    if (action === 'proposal.submit' && p) p.status = 'awaiting_approval';
    if (action === 'proposal.sent' && p) p.status = 'sent';
    if (action === 'proposal.close' && p) p.status = body.outcome as 'accepted' | 'rejected';
    return (this.workerReplies[action] ?? { ok: true }) as T;
  }

  // --- operations ---
  project: ProjectDetail = {
    id: 'pr1',
    name: 'Örnek Diş Kliniği — Sistem',
    company_id: 'c1',
    company_name: 'Örnek Diş Kliniği',
    package_code: 'sistem',
    status: 'setup',
    started_on: '2026-10-13',
    contract_end: '2027-01-12',
    tasks_done: 0,
    tasks_total: 2,
    payment_path: 'setup',
    monthly_kurus: 2_167_500,
    setup_fee_kurus: 1_530_000,
    project_kurus: null,
    satisfaction: null,
    form: {
      status: 'submitted',
      url: 'https://api.test/kurulum/abc',
      expires_at: '2026-11-12T00:00:00Z',
    },
    tasks: [
      { id: 't1', title: 'Kurulum formu gözden geçirildi', module_code: null, done: false },
      {
        id: 't2',
        title: 'Site sohbet kutusu kodu siteye eklendi',
        module_code: 'cevap-asistani',
        done: false,
      },
    ],
    artifacts: {
      claude_prompt: '# Örnek Diş Kliniği — Sistem kurulumu\nwrangler secret put',
      config: '{"version":1}',
    },
    payments: [],
  };
  payments: PaymentItem[] = [
    {
      id: 'pay1',
      company_id: 'c1',
      company_name: 'Örnek Diş Kliniği',
      kind: 'setup',
      amount_kurus: 1_530_000,
      due_on: '2026-10-13',
      status: 'due',
      paid_on: null,
      payment_link: null,
    },
  ];
  financeEntries: FinanceEntry[] = [];
  noteRows: NoteItem[] = [
    {
      id: 'n1',
      body: 'Klinikler için #randevu paketi fikri',
      tags: ['randevu'],
      source: 'telegram_text',
      company_id: null,
      created_at: '2026-10-13T09:00:00Z',
    },
  ];

  async listProjects() {
    return [this.project];
  }
  async getProject(id: string) {
    return id === this.project.id ? this.project : null;
  }
  async setTaskDone(taskId: string, done: boolean) {
    const t = this.project.tasks.find((x) => x.id === taskId);
    if (t) t.done = done;
    this.project.tasks_done = this.project.tasks.filter((x) => x.done).length;
  }
  async updateProject(id: string, patch: Partial<Pick<ProjectDetail, 'status' | 'satisfaction'>>) {
    if (id === this.project.id) Object.assign(this.project, patch);
  }
  async financeSummary() {
    return {
      mrrKurus: 1_734_000,
      targetKurus: 10_000_000,
      open: this.payments.filter((p) => p.status === 'due'),
      monthIncomeKurus: this.financeEntries
        .filter((e) => e.kind === 'income')
        .reduce((n, e) => n + e.amount_kurus, 0),
      monthExpenseKurus: this.financeEntries
        .filter((e) => e.kind === 'expense')
        .reduce((n, e) => n + e.amount_kurus, 0),
      entries: this.financeEntries,
      activeSubscriptions: 1,
    };
  }
  async markPaymentPaid(id: string, paidOn: string) {
    const p = this.payments.find((x) => x.id === id);
    if (p) Object.assign(p, { status: 'paid', paid_on: paidOn });
  }
  async setPaymentLink(id: string, link: string | null) {
    const p = this.payments.find((x) => x.id === id);
    if (p) p.payment_link = link;
  }
  async addFinanceEntry(e: Omit<FinanceEntry, 'id'>) {
    this.financeEntries.push({ ...e, id: `f${this.financeEntries.length + 1}` });
  }
  async listNotes(query: string) {
    const q = query.trim().toLocaleLowerCase('tr');
    return this.noteRows.filter((n) =>
      !q
        ? true
        : q.startsWith('#')
          ? n.tags.includes(q.slice(1))
          : n.body.toLocaleLowerCase('tr').includes(q),
    );
  }
  async addNote(body: string, tags: string[]) {
    this.noteRows.unshift({
      id: `n${this.noteRows.length + 1}`,
      body,
      tags,
      source: 'panel',
      company_id: null,
      created_at: '2026-10-13T10:00:00Z',
    });
  }

  // --- Phase 6 ---
  routines: RoutineItem[] = [
    {
      id: 'r1',
      code: 'sabah_brifingi',
      name: 'Sabah brifingi',
      action: 'morning_brief',
      schedule: { kind: 'weekdays', time: '08:45' },
      params: {},
      enabled: true,
      source: 'preset',
      next_run_at: '2026-10-14T05:45:00Z',
      last_run_at: '2026-10-13T05:45:00Z',
      last_result: '☀️ Günaydın, bugün: • Onay bekleyen: 2',
    },
    {
      id: 'r2',
      code: 'haftalik_patron_ozeti',
      name: 'Haftalık patron özeti',
      action: 'weekly_summary',
      schedule: { kind: 'weekly', time: '17:00', days: [5] },
      params: {},
      enabled: true,
      source: 'preset',
      next_run_at: null,
      last_run_at: null,
      last_result: null,
    },
  ];
  async listRoutines() {
    return this.routines;
  }
  async updateRoutine(id: string, patch: Partial<Pick<RoutineItem, 'enabled' | 'schedule'>>) {
    const r = this.routines.find((x) => x.id === id);
    if (r) Object.assign(r, patch, { next_run_at: null });
  }

  content: ContentItem[] = [
    {
      id: 'ci1',
      platform: 'x',
      week_of: '2026-10-12',
      topic: 'Gece gelen mesajlar',
      body: 'Gece 23:00 gelen mesaj sabaha kalırsa müşteri rakibe gider.',
      status: 'approved',
      posted_at: null,
    },
    {
      id: 'ci2',
      platform: 'linkedin',
      week_of: '2026-10-12',
      topic: 'Refleks',
      body: 'Personel değil, refleks kuruyoruz.',
      status: 'awaiting_approval',
      posted_at: null,
    },
  ];
  async listContent() {
    return this.content;
  }
  async markContentPosted(id: string) {
    const c = this.content.find((x) => x.id === id);
    if (c && c.status === 'approved') {
      c.status = 'posted';
      c.posted_at = '2026-10-13T10:00:00Z';
    }
  }

  metricsCalls: MetricsFilter[] = [];
  async metrics(f: MetricsFilter): Promise<MetricsSummary> {
    this.metricsCalls.push(f);
    const k = f.playbook === 'all' ? 1 : 0.5;
    return {
      funnel: {
        contacted: 120 * k,
        replied: 18 * k,
        positive: 9 * k,
        meetings: 4 * k,
        proposals: 3 * k,
        won: 1 * k,
      },
      firstReplyHours: 13,
      mrrKurus: 2_167_500,
      targetKurus: 10_000_000,
      pipelineKurus: 4_000_000,
      clients: {
        active: 1,
        avgMonthlyKurus: 2_167_500,
        cancelled: 0,
        renewals: [{ company_name: 'Örnek Diş Kliniği', contract_end: '2026-11-20' }],
      },
      health: {
        quota: [{ bucket: 'gemini', used: 40, rpd: 250 }],
        queued: 3,
        dead: 1,
        errors24h: 2,
        oldestApprovalAt: '2026-10-12T08:00:00Z',
      },
      usage: [
        { label: 'Supabase veritabanı', used: 42.5, limit: 500, unit: 'MB' },
        {
          label: 'GitHub Actions (bu ay)',
          used: 1850,
          limit: 2000,
          unit: 'dk',
          note: 'tahmin',
        },
      ],
      playbooks: ['soguk_ana', 'sinyal'],
    };
  }

  mapRows: MapCompany[] = [
    {
      id: 'm1',
      name: 'Uzak Otel',
      lat: 39.7,
      lng: 27.95,
      score: 55,
      stage: 'analyzed',
      city: 'Balıkesir',
      address: 'Uzak Cd. 9',
      phone_e164: null,
    },
    {
      id: 'c1',
      name: 'Örnek Diş Kliniği',
      lat: 39.65,
      lng: 27.89,
      score: 78,
      stage: 'in_playbook',
      city: 'Balıkesir',
      address: 'Anafartalar Cd. 1',
      phone_e164: '902661234567',
    },
    {
      id: 'm3',
      name: 'Soğuk Galeri',
      lat: 39.6,
      lng: 27.8,
      score: 20,
      stage: 'waitlist',
      city: 'Balıkesir',
      address: null,
      phone_e164: null,
    },
  ];
  deleted: string[] = [];
  async deleteCompanyPersonalData(companyId: string) {
    this.deleted.push(companyId);
  }
  async mapCompanies() {
    return { companies: this.mapRows, home: { lat: 39.6484, lng: 27.8826 } };
  }
}
