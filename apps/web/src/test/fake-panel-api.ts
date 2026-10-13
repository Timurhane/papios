import type { CompanyDetail, CompanySummary, NextStepUpdate, PanelApi } from '@/data/types';

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
      pendingApprovals: [{ id: 'a1', title: 'Mail: Örnek Klinik' }],
      recentlyAnalyzed: this.companies.slice(0, 1),
      dueWaiting: [],
      quota: [{ bucket: 'gemini', used: 12 }],
    };
  }
}
