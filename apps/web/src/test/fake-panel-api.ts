import type {
  ApprovalEdit,
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
}
