import {
  defaultSettings,
  MemoryLLMStore,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  type DedupeKeys,
  type FounderTerms,
  type SiteFeatures,
  type Job,
  type PlaybookStep,
  type QueueStore,
  type Settings,
} from '@papi/core';
import type {
  ActivityCounts,
  AnalysisRecord,
  ApprovalRow,
  CompanyPatch,
  CompanyRow,
  ContentItemRow,
  DemoRow,
  DemoTouch,
  EmbeddingTable,
  EnrollmentRow,
  InboxInput,
  InboxRow,
  KnowledgeHit,
  MeetingRow,
  NoteRow,
  PaymentRow,
  ProjectRow,
  SetupFormLookup,
  SetupFormRow,
  SubscriptionRow,
  NewCompany,
  PlaybookWithSteps,
  ProposalRow,
  ProposalStatus,
  Repo,
  RoutineRow,
  SalesStats,
  SuggestionRow,
  ServicePackage,
  TouchRow,
  TouchStatus,
  UsageSummary,
} from './types.ts';

const step = (
  p: Partial<PlaybookStep> & Pick<PlaybookStep, 'position' | 'day_offset' | 'channel'>,
): PlaybookStep => ({
  anchor: 'start',
  repeat_every_days: null,
  angle: 'açı',
  conditions: {},
  requires_approval: !['phone_call', 'visit'].includes(p.channel),
  approval_exempt_kind: null,
  ...p,
});

/** Subset of the seeded playbooks (supabase/seed/40_playbooks.sql) for tests. */
export const TEST_PLAYBOOKS: PlaybookWithSteps[] = [
  {
    id: 'pb-soguk-ana',
    code: 'soguk_ana',
    name: 'Soğuk Ana',
    steps: [
      step({
        position: 1,
        day_offset: 1,
        channel: 'email',
        angle: 'Analizden tek somut bulgu, en fazla 80 kelime',
        conditions: { requires: ['email'] },
      }),
      step({
        position: 2,
        day_offset: 3,
        channel: 'whatsapp',
        angle: 'Maile kısa atıf',
        conditions: { requires: ['phone'] },
      }),
      step({
        position: 3,
        day_offset: 5,
        channel: 'instagram_dm',
        angle: 'Kısa, samimi DM',
        conditions: { requires: ['instagram'] },
      }),
      step({ position: 4, day_offset: 7, channel: 'demo', angle: 'Kişiye özel demo' }),
      step({ position: 5, day_offset: 10, channel: 'phone_call', angle: 'Telefon' }),
      step({
        position: 6,
        day_offset: 14,
        channel: 'email',
        angle: 'Kısa fikir veya örnek',
        conditions: { requires: ['email'] },
      }),
      step({
        position: 7,
        day_offset: 17,
        channel: 'linkedin',
        angle: 'Kısa LinkedIn mesajı',
        conditions: { requires: ['linkedin'] },
      }),
      step({
        position: 8,
        day_offset: 21,
        channel: 'email',
        angle: 'Kapanış maili',
        conditions: { requires: ['email'] },
      }),
    ],
  },
  {
    id: 'pb-hafif-soguk',
    code: 'hafif_soguk',
    name: 'Hafif Soğuk',
    steps: [
      step({ position: 1, day_offset: 1, channel: 'email', conditions: { requires: ['email'] } }),
      step({ position: 2, day_offset: 14, channel: 'email', conditions: { requires: ['email'] } }),
    ],
  },
  {
    id: 'pb-simdi-degil',
    code: 'simdi_degil',
    name: 'Şimdi Değil',
    steps: [step({ position: 1, day_offset: 90, channel: 'email' })],
  },
  {
    id: 'pb-musteri-yasami',
    code: 'musteri_yasami',
    name: 'Müşteri Yaşamı',
    steps: [
      step({ position: 1, day_offset: 7, channel: 'whatsapp', angle: '1. hafta kontrolü' }),
      step({
        position: 2,
        day_offset: 30,
        channel: 'email',
        angle: 'Aylık rapor',
        repeat_every_days: 30,
      }),
      step({
        position: 3,
        day_offset: -30,
        anchor: 'contract_end',
        channel: 'email',
        angle: 'Yenileme',
      }),
    ],
  },
  {
    id: 'pb-referans',
    code: 'referans',
    name: 'Referans',
    steps: [
      step({ position: 1, day_offset: 30, channel: 'whatsapp', angle: 'Memnuniyet sorusu' }),
      step({
        position: 2,
        day_offset: 33,
        channel: 'whatsapp',
        angle: 'Referans isteği',
        conditions: { only_if: 'satisfaction_positive' },
      }),
    ],
  },
  {
    id: 'pb-teklif-takibi',
    code: 'teklif_takibi',
    name: 'Teklif Takibi',
    steps: [
      step({ position: 1, day_offset: 2, channel: 'email', angle: 'Teklifle ilgili soru' }),
      step({ position: 2, day_offset: 20, channel: 'email', angle: 'Son takip' }),
    ],
  },
];

const TOUCH_DEFAULTS: Omit<TouchRow, 'id' | 'company_id' | 'channel' | 'status'> = {
  contact_id: null,
  enrollment_id: null,
  step_position: null,
  recipient: null,
  subject: null,
  body: null,
  skip_reason: null,
  approval_id: null,
  due_at: null,
  sent_at: null,
  provider_message_id: null,
  thread_id: null,
  cold: false,
};

function normalizeFor(kind: string, value: string): string {
  if (kind === 'email') return normalizeEmail(value) ?? value.toLowerCase();
  if (kind === 'phone') return normalizePhone(value) ?? value;
  if (kind === 'domain') return normalizeDomain(value) ?? value.toLowerCase();
  return value.trim().toLowerCase().replace(/^@/, '');
}

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
  companies: (CompanyRow & Record<string, unknown>)[] = [];
  analyses: (AnalysisRecord & { id: string })[] = [];
  scores: { companyId: string; total: number }[] = [];
  events: { companyId: string; kind: string; summary: string }[] = [];
  contacts: {
    companyId: string;
    source: string;
    full_name?: string | null;
    email?: string | null;
  }[] = [];
  memories: { subjectId: string; kind: string; content: string }[] = [];
  signalsByCompany = new Map<string, string[]>();
  playbooks: PlaybookWithSteps[] = structuredClone(TEST_PLAYBOOKS);
  enrollments: (EnrollmentRow & { stop_reason?: string })[] = [];
  touches: TouchRow[] = [];
  inbox: (InboxInput & { id: string })[] = [];
  suppressed = new Set<string>();
  tone = { description: '', dos: [] as string[], donts: [] as string[], examples: [] as string[] };
  banned: string[] = [];
  founderSlots = { total: 3, used: 0 };
  packages: ServicePackage[] = [
    {
      code: 'refleks',
      name: 'Refleks',
      monthly_kurus: 1_750_000,
      starting_from: false,
      has_payment_paths: true,
      summary: 'Gelen her mesaja anında cevap ve takip.',
      features: ['Anında cevap veren asistan', 'Aylık performans raporu'],
    },
    {
      code: 'sistem',
      name: 'Sistem',
      monthly_kurus: 2_550_000,
      starting_from: false,
      has_payment_paths: true,
      summary: "Refleks'in tamamı + satış, randevu ve yorum otomasyonları.",
      features: ['Teklif ve satış takibi', 'Randevu ve ödeme hatırlatmaları'],
    },
    {
      code: 'operasyon',
      name: 'Operasyon',
      monthly_kurus: 4_000_000,
      starting_from: true,
      has_payment_paths: true,
      summary: "Sistem'in tamamı + işletmeye özel iç süreç otomasyonları.",
      features: ['İç süreç otomasyonları', 'Aylık strateji görüşmesi'],
    },
  ];
  meetings: MeetingRow[] = [];
  proposals: ProposalRow[] = [];
  demos: (DemoRow & { snapshot: Record<string, unknown>; usage: Map<string, number> })[] = [];
  rateHits = new Map<string, number>();
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
    return items.map((a) => a.id);
  }
  async addStyleMemory(input: unknown) {
    this.styleMemory.push(input);
  }
  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: { heavy?: boolean; unique?: boolean; priority?: number } = {},
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

  // --- CRM ---
  async findCompany(k: DedupeKeys) {
    return (
      this.companies.find(
        (c) =>
          (k.domain && c.domain === k.domain) ||
          (k.phone && c.phone_e164 === k.phone) ||
          (k.instagram && c.instagram_handle === k.instagram) ||
          (k.city &&
            c.name_norm === k.nameNorm &&
            (c.city ?? '').toLocaleLowerCase('tr') === k.city),
      ) ?? null
    );
  }
  async getCompany(id: string) {
    return this.companies.find((c) => c.id === id) ?? null;
  }
  async createCompany(input: NewCompany) {
    const id = this.id();
    const for_ = (k: string) =>
      k === 'domain' || k === 'phone_e164' || k === 'instagram_handle'
        ? input[k as keyof NewCompany]
        : undefined;
    for (const key of ['domain', 'phone_e164', 'instagram_handle'] as const) {
      const v = for_(key);
      if (v && this.companies.some((c) => c[key] === v)) throw new Error(`duplicate ${key}`);
    }
    this.companies.push({
      id,
      domain: null,
      phone_e164: null,
      website_url: null,
      instagram_handle: null,
      maps_url: null,
      emails: [],
      city: null,
      district: null,
      address: null,
      sector: null,
      verified: false,
      stage: 'new',
      score: null,
      score_rationale: [],
      next_step_kind: 'waiting',
      assigned_playbook: null,
      waiting_reason: 'Analiz bekliyor',
      waiting_until: new Date().toISOString().slice(0, 10),
      last_analyzed_at: null,
      ...input,
    });
    return id;
  }
  async updateCompany(id: string, patch: CompanyPatch) {
    const c = this.companies.find((x) => x.id === id);
    if (!c) throw new Error('company not found');
    Object.assign(c, patch);
    const ok =
      (c.next_step_kind === 'playbook' && c.assigned_playbook) ||
      (c.next_step_kind === 'waiting' && c.waiting_reason && c.waiting_until) ||
      c.next_step_kind === 'closed';
    if (!ok) throw new Error('companies_next_step violated');
  }
  async addAnalysis(a: AnalysisRecord) {
    const id = this.id();
    this.analyses.push({ ...a, id });
    return id;
  }
  async addScore(companyId: string, s: { total: number }) {
    this.scores.push({ companyId, total: s.total });
  }
  async addCompanyEvent(companyId: string, kind: string, summary: string) {
    this.events.push({ companyId, kind, summary });
  }
  async addContact(
    companyId: string,
    c: {
      full_name?: string | null;
      role?: string | null;
      email?: string | null;
      phone_e164?: string | null;
      is_decision_maker?: boolean;
      source: string;
    },
  ) {
    this.contacts.push({ companyId, ...c });
  }
  async addMemory(subjectId: string, kind: string, content: string) {
    this.memories.push({ subjectId, kind, content });
  }
  async activeSignals(companyId: string) {
    return this.signalsByCompany.get(companyId) ?? [];
  }
  async searchCompanies(query: string, limit: number) {
    const q = query.toLocaleLowerCase('tr');
    return this.companies
      .filter((c) =>
        `${c.name} ${c.domain ?? ''} ${c.instagram_handle ?? ''}`
          .toLocaleLowerCase('tr')
          .includes(q),
      )
      .slice(0, limit);
  }
  async countQueuedJobs(heavy: boolean) {
    return this.jobs.filter((j) => j.status === 'queued' && j.heavy === heavy).length;
  }
  async companiesAwaitingAnalysis(limit: number) {
    return this.companies.filter((c) => c.stage === 'new').slice(0, limit);
  }

  // --- Outreach ---
  async getPlaybook(code: string) {
    return this.playbooks.find((p) => p.code === code) ?? null;
  }
  async getPlaybookById(id: string) {
    return this.playbooks.find((p) => p.id === id) ?? null;
  }
  async companiesToEnroll(limit: number) {
    return this.companies
      .filter(
        (c) =>
          c.stage === 'analyzed' &&
          c.next_step_kind === 'playbook' &&
          !this.enrollments.some((e) => e.company_id === c.id && e.status === 'active'),
      )
      .slice(0, limit);
  }
  async createEnrollment(companyId: string, playbookId: string, anchorDate: string | null) {
    if (
      this.enrollments.some(
        (e) => e.company_id === companyId && e.playbook_id === playbookId && e.status === 'active',
      )
    ) {
      throw new Error('duplicate active enrollment');
    }
    const id = this.id();
    this.enrollments.push({
      id,
      company_id: companyId,
      playbook_id: playbookId,
      status: 'active',
      started_at: this.now().toISOString(),
      anchor_date: anchorDate,
      next_position: 1,
    });
    return id;
  }
  /** Test clock for started_at. */
  now = () => new Date();
  async activeEnrollments(limit: number) {
    return this.enrollments.filter((e) => e.status === 'active').slice(0, limit);
  }
  async updateEnrollment(
    id: string,
    patch: Partial<Pick<EnrollmentRow, 'status' | 'next_position'>> & { stop_reason?: string },
  ) {
    const e = this.enrollments.find((x) => x.id === id);
    if (e) Object.assign(e, patch);
  }
  async stopEnrollments(companyId: string, reason: string) {
    const active = this.enrollments.filter(
      (e) => e.company_id === companyId && e.status === 'active',
    );
    active.forEach((e) => Object.assign(e, { status: 'stopped', stop_reason: reason }));
    if (active.length) {
      for (const t of this.touches) {
        if (
          t.company_id === companyId &&
          ['drafted', 'awaiting_approval', 'approved', 'scheduled', 'ready'].includes(t.status)
        ) {
          Object.assign(t, { status: 'cancelled', skip_reason: reason });
        }
      }
    }
    return active.length;
  }
  /** Mirrors app.enforce_suppression (K-10.13). */
  private enforceSuppression(t: TouchRow) {
    if (!['approved', 'scheduled', 'ready', 'sent'].includes(t.status)) return;
    const kind = (
      {
        email: 'email',
        whatsapp: 'phone',
        phone_call: 'phone',
        instagram_dm: 'instagram',
        linkedin: 'linkedin',
        x: 'x',
      } as Record<string, string>
    )[t.channel];
    const hit =
      (kind && t.recipient && this.suppressed.has(`${kind}:${normalizeFor(kind, t.recipient)}`)) ||
      (t.channel === 'email' &&
        t.recipient?.includes('@') &&
        this.suppressed.has(`domain:${normalizeFor('domain', t.recipient.split('@')[1] ?? '')}`)) ||
      this.suppressed.has(`company:${t.company_id}`);
    if (hit) throw new Error('recipient is on the suppression list');
  }
  async createTouch(t: Partial<TouchRow> & Pick<TouchRow, 'company_id' | 'channel' | 'status'>) {
    const row: TouchRow = { ...TOUCH_DEFAULTS, ...t, id: this.id() };
    this.enforceSuppression(row);
    this.touches.push(row);
    return row.id;
  }
  async updateTouch(id: string, patch: Partial<Omit<TouchRow, 'id'>>) {
    const t = this.touches.find((x) => x.id === id);
    if (!t) throw new Error('touch not found');
    this.enforceSuppression({ ...t, ...patch });
    Object.assign(t, patch);
  }
  async getTouch(id: string) {
    return this.touches.find((t) => t.id === id) ?? null;
  }
  async touchForStep(enrollmentId: string, position: number) {
    return (
      [...this.touches]
        .reverse()
        .find((t) => t.enrollment_id === enrollmentId && t.step_position === position) ?? null
    );
  }
  async touchByApproval(approvalId: string) {
    return this.touches.find((t) => t.approval_id === approvalId) ?? null;
  }
  async touchesByStatus(statuses: TouchStatus[], limit: number, dueBefore?: Date) {
    return this.touches
      .filter(
        (t) =>
          statuses.includes(t.status) &&
          (!dueBefore || (t.due_at !== null && Date.parse(t.due_at) <= dueBefore.getTime())),
      )
      .slice(0, limit);
  }
  async findTouchForReply(threadId: string | null, from: string) {
    return (
      (threadId && this.touches.find((t) => t.thread_id === threadId)) ||
      [...this.touches]
        .reverse()
        .find((t) => t.status === 'sent' && t.recipient?.toLowerCase() === from.toLowerCase()) ||
      null
    );
  }
  async emailsSentSince(since: Date) {
    return this.touches.filter(
      (t) =>
        t.channel === 'email' &&
        t.status === 'sent' &&
        t.sent_at &&
        Date.parse(t.sent_at) >= since.getTime(),
    ).length;
  }
  async firstEmailSentAt() {
    return (
      this.touches
        .filter((t) => t.channel === 'email' && t.sent_at)
        .map((t) => t.sent_at as string)
        .sort()[0] ?? null
    );
  }
  async lastEmailSentAt() {
    return (
      this.touches
        .filter((t) => t.channel === 'email' && t.sent_at)
        .map((t) => t.sent_at as string)
        .sort()
        .at(-1) ?? null
    );
  }
  async sentToRecipientLast7Days(recipient: string) {
    const since = this.now().getTime() - 7 * 86_400_000;
    return this.touches.filter(
      (t) =>
        t.recipient === recipient &&
        t.status === 'sent' &&
        t.sent_at &&
        Date.parse(t.sent_at) > since,
    ).length;
  }
  async isSuppressed(kind: string, value: string) {
    return this.suppressed.has(`${kind}:${normalizeFor(kind, value)}`);
  }
  async suppress(kind: string, value: string) {
    this.suppressed.add(`${kind}:${normalizeFor(kind, value)}`);
  }
  async addInboxMessage(m: InboxInput) {
    if (this.inbox.some((x) => x.providerMessageId === m.providerMessageId)) return null;
    const id = this.id();
    this.inbox.push({ ...m, id });
    return id;
  }
  async toneProfile() {
    return this.tone;
  }
  async bannedPhrases() {
    return this.banned;
  }
  async recentStyleCorrections(draftKind: string, limit: number) {
    return (
      this.styleMemory as {
        draftKind: string;
        verdict: string;
        original: string;
        instruction: string | null;
        revised: string | null;
      }[]
    )
      .filter((m) => m.draftKind === draftKind && m.verdict !== 'approved')
      .slice(-limit)
      .map(({ original, instruction, revised }) => ({ original, instruction, revised }));
  }
  async founderSlotsAvailable() {
    return this.founderSlots.used < this.founderSlots.total;
  }
  async latestAnalysis(companyId: string) {
    const a = [...this.analyses]
      .reverse()
      .find((x) => x.companyId === companyId && x.status !== 'failed');
    return a ? { findings: a.findings, strongest_finding: a.strongestFinding } : null;
  }
  async primaryContact(companyId: string) {
    const c = this.contacts.find((x) => x.companyId === companyId);
    return c ? { id: `contact-${companyId}`, full_name: c.full_name ?? null } : null;
  }
  async getInboxMessage(id: string): Promise<InboxRow | null> {
    return this.inbox.find((m) => m.id === id) ?? null;
  }
  async servicePackages() {
    return this.packages;
  }
  async founderTerms(): Promise<FounderTerms | null> {
    return {
      slotsLeft: this.founderSlots.total - this.founderSlots.used,
      setupMaxPct: 40,
      setupPct: 40,
      monthlyPct: 20,
      monthlyMonths: 3,
    };
  }
  async contactNames(companyId: string) {
    return this.contacts
      .filter((c) => c.companyId === companyId)
      .map((c) => c.full_name)
      .filter((n): n is string => !!n);
  }
  async createMeeting(
    m: Partial<Omit<MeetingRow, 'id'>> & Pick<MeetingRow, 'company_id' | 'status'>,
  ) {
    const id = this.id();
    this.meetings.push({
      proposed_slots: [],
      starts_at: null,
      duration_minutes: 30,
      calendar_event_id: null,
      notes_raw: null,
      notes: null,
      source: null,
      ...m,
      id,
    });
    return id;
  }
  async updateMeeting(id: string, patch: Partial<Omit<MeetingRow, 'id' | 'company_id'>>) {
    const m = this.meetings.find((x) => x.id === id);
    if (m) Object.assign(m, patch);
  }
  async getMeeting(id: string) {
    return this.meetings.find((m) => m.id === id) ?? null;
  }
  async latestMeeting(companyId: string) {
    return [...this.meetings].reverse().find((m) => m.company_id === companyId) ?? null;
  }
  async createProposal(
    p: Partial<Omit<ProposalRow, 'id' | 'number'>> &
      Pick<ProposalRow, 'company_id' | 'package_code' | 'valid_until' | 'status'>,
  ) {
    if (p.vat_mode == null && p.status !== 'draft' && p.status !== 'cancelled')
      throw new Error('proposals_vat_before_approval');
    const id = this.id();
    const number = `AJNA-2026-${String(this.proposals.length + 1).padStart(4, '0')}`;
    this.proposals.push({
      meeting_id: null,
      monthly_kurus: null,
      quote: {},
      founder_discount: null,
      vat_mode: null,
      intro: null,
      scope: [],
      approval_id: null,
      pdf_path: null,
      sent_at: null,
      ...p,
      id,
      number,
    });
    return { id, number };
  }
  async updateProposal(id: string, patch: Partial<Omit<ProposalRow, 'id' | 'number'>>) {
    const p = this.proposals.find((x) => x.id === id);
    if (!p) return;
    const next = { ...p, ...patch };
    if (next.vat_mode == null && next.status !== 'draft' && next.status !== 'cancelled')
      throw new Error('proposals_vat_before_approval');
    Object.assign(p, patch);
  }
  async getProposal(id: string) {
    return this.proposals.find((p) => p.id === id) ?? null;
  }
  async proposalByApproval(approvalId: string) {
    return this.proposals.find((p) => p.approval_id === approvalId) ?? null;
  }
  async proposalsByStatus(statuses: ProposalStatus[], limit: number) {
    return this.proposals.filter((p) => statuses.includes(p.status)).slice(0, limit);
  }
  async acceptProposal(id: string) {
    const p = this.proposals.find((x) => x.id === id);
    if (!p || (p.status !== 'sent' && p.status !== 'approved')) return false;
    if (p.founder_discount) {
      if (this.founderSlots.used >= this.founderSlots.total)
        throw new Error('Kurucu müşteri kontenjanı dolu');
      this.founderSlots.used++;
    }
    p.status = 'accepted';
    this.events.push({ companyId: p.company_id, kind: 'proposal_accepted', summary: p.number });
    return true;
  }
  async createDemo(d: {
    company_id: string;
    token: string;
    snapshot: Record<string, unknown>;
    expires_at: string;
  }) {
    if (d.token.length < 40) throw new Error('demo token too short');
    const id = this.id();
    this.demos.push({ ...d, id, status: 'active', visits: 0, messages: 0, usage: new Map() });
    return id;
  }
  async activeDemo(companyId: string) {
    const t = this.now().getTime();
    return (
      [...this.demos]
        .reverse()
        .find(
          (d) =>
            d.company_id === companyId && d.status === 'active' && Date.parse(d.expires_at) > t,
        ) ?? null
    );
  }
  async demoTouch(token: string, kind: 'visit' | 'message', perDemo: number, total: number) {
    const d = this.demos.find((x) => x.token === token);
    const out = (result: DemoTouch['result'], snapshot: Record<string, unknown> | null = null) => ({
      result,
      demoId: d?.id ?? null,
      companyId: d?.company_id ?? null,
      snapshot,
      expiresAt: d?.expires_at ?? null,
    });
    if (!d) return out('not_found');
    if (d.status !== 'active' || Date.parse(d.expires_at) <= this.now().getTime()) {
      d.status = 'closed';
      return out('expired');
    }
    if (kind === 'visit') {
      if (d.visits === 0)
        this.events.push({
          companyId: d.company_id,
          kind: 'demo_visit',
          summary: 'Demo ilk kez açıldı',
        });
      d.visits++;
      return out('ok', d.snapshot);
    }
    const day = this.now().toISOString().slice(0, 10);
    const all = this.demos.reduce((n, x) => n + (x.usage.get(day) ?? 0), 0);
    if (all >= total) return out('total_limit');
    const used = d.usage.get(day) ?? 0;
    if (used >= perDemo) return out('demo_limit');
    d.usage.set(day, used + 1);
    d.messages++;
    return out('ok', d.snapshot);
  }
  async hitRateLimit(key: string, _windowSeconds: number, max: number) {
    const n = (this.rateHits.get(key) ?? 0) + 1;
    this.rateHits.set(key, n);
    return n <= max;
  }
  members = new Set<string>();
  async isMember(userId: string) {
    return this.members.has(userId);
  }
  // --- operations ---
  projects: ProjectRow[] = [];
  projectTaskRows: {
    projectId: string;
    title: string;
    module_code: string | null;
    done: boolean;
  }[] = [];
  setupForms: (SetupFormRow & { submitted_at?: string })[] = [];
  artifactRows: { projectId: string; kind: string; content: string }[] = [];
  subscriptions: SubscriptionRow[] = [];
  payments: PaymentRow[] = [];
  notes: NoteRow[] = [];
  metrics: { projectId: string; period: string; metrics: Record<string, number> }[] = [];

  async createProject(
    p: Omit<ProjectRow, 'id' | 'satisfaction' | 'status'> & { status?: ProjectRow['status'] },
  ) {
    if (p.metrics_token.length < 40) throw new Error('metrics token too short');
    if (p.proposal_id && this.projects.some((x) => x.proposal_id === p.proposal_id))
      throw new Error('duplicate key value violates unique constraint "projects_proposal_uniq"');
    const id = this.id();
    this.projects.push({ status: 'setup', satisfaction: null, ...p, id });
    return id;
  }
  async getProject(id: string) {
    return this.projects.find((p) => p.id === id) ?? null;
  }
  async projectByProposal(proposalId: string) {
    return this.projects.find((p) => p.proposal_id === proposalId) ?? null;
  }
  async projectByMetricsToken(token: string) {
    return this.projects.find((p) => p.metrics_token === token) ?? null;
  }
  async activeProjects(limit: number) {
    return this.projects
      .filter((p) => p.status === 'setup' || p.status === 'active')
      .slice(0, limit);
  }
  async updateProject(id: string, patch: Partial<Omit<ProjectRow, 'id' | 'company_id'>>) {
    const p = this.projects.find((x) => x.id === id);
    if (p) Object.assign(p, patch);
  }
  async replaceProjectTasks(projectId: string, items: { title: string; module: string | null }[]) {
    const done = new Set(
      this.projectTaskRows.filter((t) => t.projectId === projectId && t.done).map((t) => t.title),
    );
    this.projectTaskRows = this.projectTaskRows.filter((t) => t.projectId !== projectId);
    for (const it of items)
      this.projectTaskRows.push({
        projectId,
        title: it.title,
        module_code: it.module,
        done: done.has(it.title),
      });
  }
  async projectTasks(projectId: string) {
    return this.projectTaskRows
      .filter((t) => t.projectId === projectId)
      .map(({ title, module_code, done }) => ({ title, module_code, done }));
  }
  async createSetupForm(f: {
    project_id: string;
    token: string;
    package_code: string;
    expires_at: string;
  }) {
    const id = this.id();
    this.setupForms.push({ ...f, id, answers: {}, status: 'sent' });
    return id;
  }
  async setupFormByProject(projectId: string) {
    return this.setupForms.find((f) => f.project_id === projectId) ?? null;
  }
  async setupFormByToken(token: string): Promise<SetupFormLookup> {
    const f = this.setupForms.find((x) => x.token === token);
    if (!f)
      return {
        result: 'not_found',
        formId: null,
        projectId: null,
        packageCode: null,
        businessName: null,
        expiresAt: null,
      };
    const project = this.projects.find((p) => p.id === f.project_id);
    const company = this.companies.find((c) => c.id === project?.company_id);
    return {
      result:
        Date.parse(f.expires_at) <= this.now().getTime()
          ? 'expired'
          : f.status !== 'sent'
            ? 'submitted'
            : 'ok',
      formId: f.id,
      projectId: f.project_id,
      packageCode: f.package_code,
      businessName: company?.name ?? null,
      expiresAt: f.expires_at,
    };
  }
  async submitSetupForm(token: string, answers: Record<string, unknown>) {
    const f = this.setupForms.find((x) => x.token === token);
    if (!f || f.status !== 'sent' || Date.parse(f.expires_at) <= this.now().getTime()) return false;
    Object.assign(f, { answers, status: 'submitted', submitted_at: this.now().toISOString() });
    return true;
  }
  async upsertArtifact(
    projectId: string,
    kind: 'config' | 'claude_prompt' | 'checklist',
    content: string,
  ) {
    const a = this.artifactRows.find((x) => x.projectId === projectId && x.kind === kind);
    if (a) a.content = content;
    else this.artifactRows.push({ projectId, kind, content });
  }
  async artifacts(projectId: string) {
    return this.artifactRows
      .filter((a) => a.projectId === projectId)
      .map(({ kind, content }) => ({ kind, content }));
  }
  async createSubscription(sub: Omit<SubscriptionRow, 'id' | 'status'>) {
    const id = this.id();
    this.subscriptions.push({ ...sub, id, status: 'active' });
    return id;
  }
  async activeSubscriptions(limit: number) {
    return this.subscriptions.filter((x) => x.status === 'active').slice(0, limit);
  }
  async ensurePayment(p: Omit<PaymentRow, 'id' | 'status' | 'paid_on' | 'overdue_notified_on'>) {
    if (
      p.subscription_id &&
      this.payments.some((x) => x.subscription_id === p.subscription_id && x.due_on === p.due_on)
    )
      return false;
    this.payments.push({
      ...p,
      id: this.id(),
      status: 'due',
      paid_on: null,
      overdue_notified_on: null,
    });
    return true;
  }
  async duePayments(limit: number) {
    return this.payments
      .filter((p) => p.status === 'due')
      .sort((a, b) => a.due_on.localeCompare(b.due_on))
      .slice(0, limit);
  }
  async markPayment(
    id: string,
    patch: Partial<Pick<PaymentRow, 'status' | 'paid_on' | 'overdue_notified_on'>>,
  ) {
    const p = this.payments.find((x) => x.id === id);
    if (!p) return;
    if (patch.status === 'paid' && !(patch.paid_on ?? p.paid_on))
      throw new Error('payments_paid_has_date');
    Object.assign(p, patch);
  }
  async addNote(n: Omit<NoteRow, 'id' | 'created_at'>) {
    const id = this.id();
    this.notes.push({ ...n, id, created_at: this.now().toISOString() });
    return id;
  }
  async recentNotes(limit: number, query?: string) {
    const q = query?.toLocaleLowerCase('tr');
    return [...this.notes]
      .reverse()
      .filter((n) => !q || n.body.toLocaleLowerCase('tr').includes(q))
      .slice(0, limit);
  }
  async upsertModuleMetrics(projectId: string, period: string, metrics: Record<string, number>) {
    const m = this.metrics.find((x) => x.projectId === projectId && x.period === period);
    if (m) m.metrics = metrics;
    else this.metrics.push({ projectId, period, metrics });
  }
  async moduleMetrics(projectId: string, period: string) {
    return (
      this.metrics.find((x) => x.projectId === projectId && x.period === period)?.metrics ?? null
    );
  }
  async companyFacts(companyId: string) {
    return {
      satisfaction_positive: this.projects.some(
        (p) => p.company_id === companyId && p.satisfaction === 'positive',
      ),
    };
  }
  async setupContact(projectId: string) {
    const a = (this.setupForms.find((f) => f.project_id === projectId)?.answers ?? {}) as Record<
      string,
      unknown
    >;
    const str = (v: unknown) => (typeof v === 'string' && v ? v : null);
    return { name: str(a.contact_name), email: str(a.contact_email), phone: str(a.contact_phone) };
  }

  // --- intelligence & automation ---
  routines: RoutineRow[] = [];
  signalRows: {
    companyId: string;
    kind: string;
    description: string;
    fingerprint: string | null;
  }[] = [];
  snapshots = new Map<string, SiteFeatures>();
  contentItems: ContentItemRow[] = [];
  suggestions: (SuggestionRow & { fingerprint: string })[] = [];
  geocache = new Map<string, { lat: number | null; lng: number | null; found: boolean }>();
  locations = new Map<string, { lat: number | null; lng: number | null }>();
  activity: ActivityCounts = {
    newCompanies: 0,
    analyses: 0,
    approvalsCreated: 0,
    signals: 0,
    errors: 0,
    touchesSent: 0,
    replies: 0,
  };
  stats: SalesStats = {
    contacted: 0,
    replied: 0,
    positive: 0,
    meetings: 0,
    proposals: 0,
    won: 0,
    pipelineKurus: 0,
  };
  steps: { playbook: string; position: number; angle: string; sent: number; replies: number }[] =
    [];
  noteVectors: { id: string; body: string; created_at: string; score: number }[] = [];

  async listRoutines() {
    return this.routines;
  }
  async getRoutine(id: string) {
    return this.routines.find((r) => r.id === id) ?? null;
  }
  async dueRoutines(now: Date, limit: number) {
    return this.routines
      .filter((r) => r.enabled && (!r.next_run_at || Date.parse(r.next_run_at) <= now.getTime()))
      .slice(0, limit);
  }
  async createRoutine(
    r: Pick<RoutineRow, 'code' | 'name' | 'schedule' | 'action' | 'params' | 'source'> & {
      next_run_at: string;
    },
  ) {
    const id = this.id();
    this.routines.push({ ...r, id, enabled: true, last_run_at: null, last_result: null });
    return id;
  }
  async updateRoutine(id: string, patch: Partial<Omit<RoutineRow, 'id' | 'code'>>) {
    const r = this.routines.find((x) => x.id === id);
    if (r) Object.assign(r, patch);
  }
  async addSignal(sig: {
    companyId: string;
    kind: string;
    description: string;
    fingerprint: string | null;
  }) {
    if (
      sig.fingerprint &&
      this.signalRows.some(
        (x) => x.companyId === sig.companyId && x.fingerprint === sig.fingerprint,
      )
    )
      return false;
    this.signalRows.push({
      companyId: sig.companyId,
      kind: sig.kind,
      description: sig.description,
      fingerprint: sig.fingerprint,
    });
    return true;
  }
  async siteSnapshot(companyId: string) {
    return this.snapshots.get(companyId) ?? null;
  }
  async saveSiteSnapshot(companyId: string, features: SiteFeatures) {
    this.snapshots.set(companyId, features);
  }
  async companiesForSignalScan(minScore: number, limit: number) {
    return this.companies
      .filter(
        (c) =>
          (c.score ?? 0) >= minScore &&
          c.website_url &&
          !['won', 'lost', 'closed'].includes(c.stage),
      )
      .slice(0, limit);
  }
  async addContentItem(c: Omit<ContentItemRow, 'id' | 'status' | 'approval_id'>) {
    const id = this.id();
    this.contentItems.push({ ...c, id, status: 'awaiting_approval', approval_id: null });
    return id;
  }
  async updateContentItem(
    id: string,
    patch: Partial<Pick<ContentItemRow, 'status' | 'approval_id' | 'body'>> & {
      posted_at?: string;
    },
  ) {
    const c = this.contentItems.find((x) => x.id === id);
    if (c) {
      const { posted_at: _p, ...rest } = patch;
      Object.assign(c, rest);
    }
  }
  async contentByApproval(approvalId: string) {
    return this.contentItems.find((c) => c.approval_id === approvalId) ?? null;
  }
  async addSuggestion(sg: {
    kind: SuggestionRow['kind'];
    title: string;
    detail: Record<string, unknown>;
    fingerprint: string;
  }) {
    if (this.suggestions.some((x) => x.fingerprint === sg.fingerprint)) return null;
    const id = this.id();
    this.suggestions.push({ ...sg, id, status: 'pending', approval_id: null });
    return id;
  }
  async updateSuggestion(
    id: string,
    patch: Partial<Pick<SuggestionRow, 'status' | 'approval_id'>>,
  ) {
    const x = this.suggestions.find((y) => y.id === id);
    if (x) Object.assign(x, patch);
  }
  async suggestionByApproval(approvalId: string) {
    return this.suggestions.find((x) => x.approval_id === approvalId) ?? null;
  }
  async automationApprovalsAwaiting(limit: number) {
    return [
      ...this.contentItems
        .filter((c) => c.status === 'awaiting_approval' && c.approval_id)
        .map((c) => c.approval_id as string),
      ...this.suggestions
        .filter((x) => x.status === 'pending' && x.approval_id)
        .map((x) => x.approval_id as string),
    ].slice(0, limit);
  }
  async correctionInstructions() {
    return (this.styleMemory as { instruction?: string | null }[])
      .map((m) => m.instruction)
      .filter((x): x is string => !!x);
  }
  async stepStats() {
    return this.steps;
  }
  async addToneRule(rule: string) {
    if (!this.tone.donts.includes(rule)) this.tone.donts.push(rule);
  }
  async activitySince() {
    return this.activity;
  }
  async salesStats() {
    return this.stats;
  }
  async topCompanies(minScore: number, limit: number) {
    return this.companies
      .filter(
        (c) =>
          (c.score ?? 0) >= minScore &&
          ['analyzed', 'in_playbook', 'replied', 'meeting'].includes(c.stage),
      )
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, limit);
  }
  async companiesNeedingGeocode(limit: number) {
    return this.companies.filter((c) => c.address && !this.locations.has(c.id)).slice(0, limit);
  }
  async setCompanyLocation(id: string, lat: number | null, lng: number | null) {
    this.locations.set(id, { lat, lng });
  }
  async geocodeCached(query: string) {
    return this.geocache.get(query) ?? null;
  }
  async cacheGeocode(query: string, r: { lat: number | null; lng: number | null; found: boolean }) {
    this.geocache.set(query, r);
  }
  async searchNotesByVector(_e: number[], limit: number) {
    return this.noteVectors.slice(0, limit);
  }
}

function dot(a: number[], b: number[]) {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}
