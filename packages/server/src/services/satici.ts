import {
  addDays,
  founderDiscountFor,
  formatTl,
  localDate,
  meetingSlots,
  quotePaths,
  redactPersonal,
  stripQuoted,
  vatLabel,
  type ChatMessage,
  type LLMService,
  type VatMode,
} from '@papi/core';
import { saticiBrief, saticiMeetingNotes, saticiProposal, saticiReply } from '@papi/prompts';
import { z } from 'zod';
import type {
  CompanyRow,
  MeetingNotes,
  MeetingRow,
  ProposalRow,
  Repo,
  ServicePackage,
} from '../repo/types.ts';
import type { CalendarProvider } from './calendar.ts';
import { greetingFor } from './ulak.ts';

export interface SalesDeps {
  repo: Repo;
  llm: LLMService;
  calendar: CalendarProvider;
  now?: () => Date;
}

const now = (d: SalesDeps) => d.now?.() ?? new Date();

const PACKAGE_CODES = ['refleks', 'sistem', 'operasyon', 'ozel'] as const;

const notesSchema = z.object({
  summary: z.string().min(1).max(1200),
  needs: z.array(z.string().max(300)).max(12),
  budget_signal: z.string().max(300).nullable(),
  objections: z.array(z.string().max(300)).max(10),
  next_step: z.string().max(300).nullable(),
  suggested_package: z.enum(PACKAGE_CODES).nullable(),
});

const proposalTextSchema = z.object({
  intro: z.string().min(1).max(1200),
  scope: z.array(z.string().min(1).max(300)).min(1).max(8),
});

const replySchema = z.object({ body: z.string().min(1).max(2000) });

const briefSchema = z.object({
  opening: z.string(),
  pains: z.array(z.string()).max(6),
  package: z.string(),
  questions: z.array(z.string()).max(8),
  watch_out: z.string().nullable(),
});

async function companyOrThrow(repo: Repo, id: string): Promise<CompanyRow> {
  const c = await repo.getCompany(id);
  if (!c) throw new Error('Firma bulunamadı');
  return c;
}

function publicFacts(
  c: CompanyRow,
  analysis: { findings: string[]; strongest_finding: string | null } | null,
) {
  return {
    isletme: c.name,
    sektor: c.sector,
    il: c.city,
    puan_gerekcesi: c.score_rationale,
    en_guclu_bulgu: analysis?.strongest_finding ?? null,
    bulgular: analysis?.findings ?? [],
  };
}

// --- meeting notes → proposal ---------------------------------------------------------------------

export interface MeetingNoteResult {
  meetingId: string;
  notes: MeetingNotes;
  redactions: number;
  proposal: { id: string; number: string; needsVat: boolean; approvalId: string | null } | null;
}

/**
 * Görüşme sonrası: Timurhan's note (voice → text) is redacted (K-4.9), structured by the model, stored,
 * and turned into a proposal draft when a package fits.
 */
export async function recordMeetingNote(
  deps: SalesDeps,
  companyId: string,
  rawText: string,
  source: 'telegram_voice' | 'telegram_text' | 'panel',
): Promise<MeetingNoteResult> {
  const company = await companyOrThrow(deps.repo, companyId);
  const [names, packages] = await Promise.all([
    deps.repo.contactNames(companyId),
    deps.repo.servicePackages(),
  ]);
  const redacted = redactPersonal(rawText, { names });
  const { data: notes } = await deps.llm.generateStructured({
    agent: 'satici',
    task: 'satici.meeting_notes',
    tier: 'medium',
    dataClass: 'internal',
    promptId: saticiMeetingNotes.id,
    promptVersion: saticiMeetingNotes.version,
    system: saticiMeetingNotes.text,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          isletme: company.name,
          sektor: company.sector,
          paketler: packages.map((p) => ({ kod: p.code, ad: p.name, ozet: p.summary })),
          not: redacted.text,
        }),
      },
    ],
    schema: notesSchema,
    schemaHint:
      '{"summary":"...","needs":["..."],"budget_signal":null,"objections":[],"next_step":null,"suggested_package":"sistem"}',
  });

  const latest = await deps.repo.latestMeeting(companyId);
  const reuse = latest && (latest.status === 'scheduled' || latest.status === 'proposed');
  const meetingId = reuse
    ? latest.id
    : await deps.repo.createMeeting({ company_id: companyId, status: 'done' });
  await deps.repo.updateMeeting(meetingId, {
    status: 'done',
    notes_raw: rawText,
    notes,
    source,
    ...(reuse && latest.starts_at ? {} : { starts_at: now(deps).toISOString() }),
  });
  await deps.repo.addCompanyEvent(
    companyId,
    'meeting_note',
    `Görüşme notu: ${notes.summary.slice(0, 140)}`,
  );
  await deps.repo.audit(
    'satici.meeting_note',
    { company_id: companyId, meeting_id: meetingId, redactions: redacted.replaced },
    { type: 'agent', id: 'satici' },
  );

  let proposal: MeetingNoteResult['proposal'] = null;
  const pkg = packages.find((p) => p.code === notes.suggested_package);
  if (pkg?.has_payment_paths && pkg.monthly_kurus) {
    proposal = await draftProposal(deps, companyId, {
      packageCode: pkg.code,
      meetingId,
      needs: notes.needs,
    });
  } else {
    await deps.repo.updateCompany(companyId, {
      stage: 'meeting',
      next_step_kind: 'waiting',
      waiting_reason: 'Görüşme yapıldı; teklif paketini seç (Teklif stüdyosu)',
      waiting_until: addDays(localDate(now(deps), 'Europe/Istanbul'), 2),
    });
  }
  return { meetingId, notes, redactions: redacted.replaced, proposal };
}

export async function draftProposal(
  deps: SalesDeps,
  companyId: string,
  opts: { packageCode: string; meetingId?: string | null; needs?: string[]; monthlyKurus?: number },
): Promise<{ id: string; number: string; needsVat: boolean; approvalId: string | null }> {
  const [company, packages, settings, terms, analysis] = await Promise.all([
    companyOrThrow(deps.repo, companyId),
    deps.repo.servicePackages(),
    deps.repo.getSettings(),
    deps.repo.founderTerms(),
    deps.repo.latestAnalysis(companyId),
  ]);
  const pkg = packages.find((p) => p.code === opts.packageCode);
  if (!pkg) throw new Error(`Paket bulunamadı: ${opts.packageCode}`);
  if (!pkg.has_payment_paths)
    throw new Error('Özel paket tekliflerini Teklif stüdyosunda iş parçalarıyla hazırla.');
  const monthly = opts.monthlyKurus ?? pkg.monthly_kurus;
  if (!monthly) throw new Error('Paketin aylık fiyatı yok');
  const founder = founderDiscountFor(terms);
  const quote = quotePaths(monthly, settings.pricing, founder);

  const { data: text } = await deps.llm.generateStructured({
    agent: 'satici',
    task: 'satici.proposal',
    tier: 'medium',
    dataClass: 'internal',
    promptId: saticiProposal.id,
    promptVersion: saticiProposal.version,
    system: saticiProposal.text,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          ...publicFacts(company, analysis),
          ihtiyaclar: opts.needs ?? [],
          paket: { ad: pkg.name, ozet: pkg.summary, ozellikler: pkg.features },
        }),
      },
    ],
    schema: proposalTextSchema,
    schemaHint: '{"intro":"...","scope":["...","..."]}',
  });

  const vat = settings.vat.mode === 'unspecified' ? null : settings.vat.mode;
  const created = await deps.repo.createProposal({
    company_id: companyId,
    meeting_id: opts.meetingId ?? null,
    status: 'draft',
    package_code: pkg.code,
    monthly_kurus: monthly,
    quote: { kind: 'paths', ...quote },
    founder_discount: founder,
    vat_mode: vat,
    valid_until: addDays(
      localDate(now(deps), 'Europe/Istanbul'),
      settings.sales.proposal_valid_days,
    ),
    intro: text.intro,
    scope: text.scope,
  });
  await deps.repo.updateCompany(companyId, {
    stage: 'proposal',
    next_step_kind: 'waiting',
    waiting_reason: `Teklif ${created.number} hazırlanıyor`,
    waiting_until: addDays(localDate(now(deps), 'Europe/Istanbul'), 2),
  });
  await deps.repo.addCompanyEvent(
    companyId,
    'proposal_drafted',
    `Teklif taslağı: ${created.number}`,
  );
  const approvalId = vat ? await submitProposal(deps, created.id) : null;
  return { ...created, needsVat: vat === null, approvalId };
}

/** K-7.2 / A-6: the VAT answer comes from Timurhan; then the draft goes to the approval queue. */
export async function setProposalVat(
  deps: SalesDeps,
  proposalId: string,
  mode: VatMode,
): Promise<string | null> {
  const p = await deps.repo.getProposal(proposalId);
  if (!p || p.status !== 'draft') return null;
  await deps.repo.updateProposal(proposalId, { vat_mode: mode });
  return submitProposal(deps, proposalId);
}

export async function submitProposal(deps: SalesDeps, proposalId: string): Promise<string> {
  const p = await deps.repo.getProposal(proposalId);
  if (!p) throw new Error('Teklif bulunamadı');
  if (!p.vat_mode) throw new Error('KDV durumu seçilmeden teklif onaya gidemez');
  const [company, packages] = await Promise.all([
    companyOrThrow(deps.repo, p.company_id),
    deps.repo.servicePackages(),
  ]);
  const pkg = packages.find((x) => x.code === p.package_code);
  const approvalId = await deps.repo.createApproval({
    kind: 'proposal',
    title: `Teklif ${p.number}: ${company.name} — ${pkg?.name ?? p.package_code}`,
    payload: {
      proposalId: p.id,
      text: proposalText(p, pkg ?? null, company.name),
      personal: p.intro ?? '',
      draftKind: 'proposal',
    },
    agent: 'satici',
  });
  await deps.repo.updateProposal(p.id, { status: 'awaiting_approval', approval_id: approvalId });
  return approvalId;
}

/** Plain-text summary of a proposal (approval card, Telegram). */
export function proposalText(
  p: ProposalRow,
  pkg: ServicePackage | null,
  companyName: string,
): string {
  const vat = p.vat_mode ? vatLabel(p.vat_mode) : 'KDV: seçilmedi';
  const lines = [
    `${companyName} — ${pkg?.name ?? p.package_code} (${p.number}, geçerlilik ${p.valid_until})`,
    '',
    p.intro ?? '',
    '',
    ...p.scope.map((s) => `• ${s}`),
  ];
  const q = p.quote as {
    kind?: string;
    noSetup?: {
      monthlyKurus: number;
      commitmentMonths: number;
      discountedMonthlyKurus: number | null;
      discountedMonths: number;
    };
    setup?: {
      monthlyKurus: number;
      setupFeeKurus: number;
      commitmentMonths: number;
      discountedMonthlyKurus: number | null;
      discountedMonths: number;
    };
  };
  if (q.kind === 'paths' && q.noSetup && q.setup) {
    const disc = (x: { discountedMonthlyKurus: number | null; discountedMonths: number }) =>
      x.discountedMonthlyKurus
        ? ` (ilk ${x.discountedMonths} ay ${formatTl(x.discountedMonthlyKurus)})`
        : '';
    lines.push(
      '',
      `Kurulumsuz: aylık ${formatTl(q.noSetup.monthlyKurus)}${disc(q.noSetup)}, ${q.noSetup.commitmentMonths} ay taahhüt — ${vat}`,
      `Kurulumlu: kurulum ${formatTl(q.setup.setupFeeKurus)} + aylık ${formatTl(q.setup.monthlyKurus)}${disc(q.setup)}, ${q.setup.commitmentMonths} ay taahhüt — ${vat}`,
    );
  }
  if (p.founder_discount)
    lines.push('', 'Kurucu müşteri indirimi uygulandı (kontenjan gerçekten açık).');
  return lines.join('\n').trim();
}

/** Approval of a proposal (Telegram inline, or the panel through the Worker). */
export async function onProposalDecided(
  deps: Pick<SalesDeps, 'repo' | 'now'>,
  approvalId: string,
  decision: 'approved' | 'rejected',
): Promise<ProposalRow | null> {
  const p = await deps.repo.proposalByApproval(approvalId);
  if (!p || p.status !== 'awaiting_approval') return null;
  if (decision === 'approved') {
    await deps.repo.updateProposal(p.id, { status: 'approved' });
    await deps.repo.updateCompany(p.company_id, {
      next_step_kind: 'waiting',
      waiting_reason: `Teklif ${p.number} onaylandı: PDF'i oluştur ve gönder`,
      waiting_until: addDays(localDate(deps.now?.() ?? new Date(), 'Europe/Istanbul'), 1),
    });
  } else {
    await deps.repo.updateProposal(p.id, { status: 'cancelled' });
    await deps.repo.updateCompany(p.company_id, {
      next_step_kind: 'waiting',
      waiting_reason: `Teklif ${p.number} reddedildi: yeni teklif ya da kapanış`,
      waiting_until: addDays(localDate(deps.now?.() ?? new Date(), 'Europe/Istanbul'), 2),
    });
  }
  return p;
}

/** Proposal delivered (mail later, or Timurhan sent the PDF himself): Teklif Takibi starts (K-11.3). */
export async function markProposalSent(deps: SalesDeps, proposalId: string): Promise<boolean> {
  const p = await deps.repo.getProposal(proposalId);
  if (!p || p.status !== 'approved') return false;
  await deps.repo.updateProposal(p.id, { status: 'sent', sent_at: now(deps).toISOString() });
  await deps.repo.stopEnrollments(p.company_id, `Teklif gönderildi (${p.number})`);
  const pb = await deps.repo.getPlaybook('teklif_takibi');
  if (pb)
    await deps.repo.createEnrollment(p.company_id, pb.id, localDate(now(deps), 'Europe/Istanbul'));
  await deps.repo.updateCompany(p.company_id, {
    stage: 'proposal',
    next_step_kind: 'playbook',
    assigned_playbook: 'teklif_takibi',
    waiting_reason: null,
    waiting_until: null,
  });
  await deps.repo.addCompanyEvent(p.company_id, 'proposal_sent', `Teklif gönderildi: ${p.number}`);
  return true;
}

export async function closeProposal(
  deps: SalesDeps,
  proposalId: string,
  outcome: 'accepted' | 'rejected',
): Promise<boolean> {
  const p = await deps.repo.getProposal(proposalId);
  if (!p) return false;
  if (outcome === 'accepted') {
    if (!(await deps.repo.acceptProposal(p.id))) return false;
  } else {
    if (p.status !== 'sent' && p.status !== 'approved') return false;
    await deps.repo.updateProposal(p.id, { status: 'rejected' });
    await deps.repo.addCompanyEvent(
      p.company_id,
      'proposal_rejected',
      `Teklif reddedildi: ${p.number}`,
    );
  }
  await deps.repo.stopEnrollments(
    p.company_id,
    `Teklif ${outcome === 'accepted' ? 'kabul' : 'ret'}`,
  );
  const today = localDate(now(deps), 'Europe/Istanbul');
  await deps.repo.updateCompany(
    p.company_id,
    outcome === 'accepted'
      ? {
          stage: 'won',
          next_step_kind: 'waiting',
          waiting_reason: 'Kazanıldı: kurulum formu ve proje (Faz 5)',
          waiting_until: addDays(today, 1),
        }
      : {
          stage: 'lost',
          next_step_kind: 'waiting',
          waiting_reason: 'Teklif reddedildi: 90 gün sonra yeniden değerlendir',
          waiting_until: addDays(today, 90),
        },
  );
  return true;
}

// --- meetings ---------------------------------------------------------------------------------

export function formatSlot(d: Date): string {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: 'Europe/Istanbul',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

/** Three free times (calendar busy times skipped when connected) stored on a proposed meeting. */
export async function proposeMeeting(
  deps: SalesDeps,
  companyId: string,
): Promise<{ meetingId: string; slots: Date[] }> {
  const settings = await deps.repo.getSettings();
  const s = settings.sales;
  const from = now(deps);
  const to = new Date(from.getTime() + (s.slot_horizon_days + 1) * 86_400_000);
  const busy = deps.calendar.configured ? await deps.calendar.busy(from, to) : [];
  const slots = meetingSlots(from, settings.business_hours, busy, {
    count: s.slot_count,
    durationMinutes: s.meeting_minutes,
    leadHours: s.slot_lead_hours,
    horizonDays: s.slot_horizon_days,
    preferredTimes: s.preferred_times,
  });
  const meetingId = await deps.repo.createMeeting({
    company_id: companyId,
    status: 'proposed',
    proposed_slots: slots.map((d) => d.toISOString()),
    duration_minutes: s.meeting_minutes,
  });
  return { meetingId, slots };
}

/** The company picked a time: event in Timurhan's calendar (no invite is sent) + CRM next step. */
export async function scheduleMeeting(
  deps: SalesDeps,
  meetingId: string,
  start: Date,
): Promise<MeetingRow> {
  const m = await deps.repo.getMeeting(meetingId);
  if (!m) throw new Error('Görüşme bulunamadı');
  const company = await companyOrThrow(deps.repo, m.company_id);
  const end = new Date(start.getTime() + m.duration_minutes * 60_000);
  const eventId = deps.calendar.configured
    ? await deps.calendar.createEvent({
        start,
        end,
        summary: `AJNA görüşme: ${company.name}`,
        description: `Papi görüşme kaydı (${m.id}). Hazırlık notu panelde firma kartında.`,
      })
    : null;
  await deps.repo.updateMeeting(m.id, {
    status: 'scheduled',
    starts_at: start.toISOString(),
    calendar_event_id: eventId,
  });
  await deps.repo.updateCompany(m.company_id, {
    stage: 'meeting',
    next_step_kind: 'waiting',
    waiting_reason: `Görüşme: ${formatSlot(start)}`,
    waiting_until: localDate(start, 'Europe/Istanbul'),
  });
  await deps.repo.addCompanyEvent(
    m.company_id,
    'meeting_scheduled',
    `Görüşme planlandı: ${formatSlot(start)}`,
  );
  return { ...m, status: 'scheduled', starts_at: start.toISOString(), calendar_event_id: eventId };
}

/** Görüşme öncesi hazırlık notu (public data only). */
export async function meetingBrief(deps: SalesDeps, companyId: string): Promise<string> {
  const [company, analysis, packages] = await Promise.all([
    companyOrThrow(deps.repo, companyId),
    deps.repo.latestAnalysis(companyId),
    deps.repo.servicePackages(),
  ]);
  const { data } = await deps.llm.generateStructured({
    agent: 'satici',
    task: 'satici.brief',
    tier: 'medium',
    dataClass: 'internal',
    promptId: saticiBrief.id,
    promptVersion: saticiBrief.version,
    system: saticiBrief.text,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({
          ...publicFacts(company, analysis),
          paketler: packages.map((p) => ({ kod: p.code, ad: p.name, ozet: p.summary })),
        }),
      },
    ],
    schema: briefSchema,
    schemaHint:
      '{"opening":"...","pains":["..."],"package":"sistem: ...","questions":["..."],"watch_out":null}',
  });
  return [
    `🎯 Hazırlık: ${company.name}`,
    '',
    `Açılış: ${data.opening}`,
    '',
    'Muhtemel dertler:',
    ...data.pains.map((p) => `• ${p}`),
    '',
    `Önerilen paket: ${data.package}`,
    '',
    'Sorular:',
    ...data.questions.map((q, i) => `${i + 1}. ${q}`),
    ...(data.watch_out ? ['', `Dikkat: ${data.watch_out}`] : []),
  ].join('\n');
}

// --- reply drafts ------------------------------------------------------------------------------

/**
 * Satıcı: draft an answer to an interested / question reply. The reply text is redacted before the
 * model sees it (K-4.9). The draft becomes an email touch awaiting approval in the same thread.
 */
export async function draftReply(deps: SalesDeps, inboxId: string): Promise<string | null> {
  const msg = await deps.repo.getInboxMessage(inboxId);
  if (!msg || !msg.companyId) return null;
  const [company, names, packages, settings, contact] = await Promise.all([
    companyOrThrow(deps.repo, msg.companyId),
    deps.repo.contactNames(msg.companyId),
    deps.repo.servicePackages(),
    deps.repo.getSettings(),
    deps.repo.primaryContact(msg.companyId),
  ]);
  const redacted = redactPersonal(stripQuoted(msg.body), { names });
  const knowledge = await deps.repo.searchKnowledgeByText(company.sector ?? 'AJNA', 3);
  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: JSON.stringify({
        isletme: company.name,
        sektor: company.sector,
        sinif: msg.classification,
        gelen_cevap: redacted.text,
        paketler: packages.map((p) => ({
          ad: p.name,
          ozet: p.summary,
          aylik: p.monthly_kurus
            ? `${formatTl(p.monthly_kurus)}${p.starting_from ? "'den başlayan" : ''}`
            : null,
        })),
        bilgi_bankasi: knowledge.map((k) => `${k.title}: ${k.content}`.slice(0, 500)),
      }),
    },
  ];
  const { data } = await deps.llm.generateStructured({
    agent: 'satici',
    task: 'satici.reply',
    tier: 'medium',
    dataClass: 'internal',
    promptId: saticiReply.id,
    promptVersion: saticiReply.version,
    system: saticiReply.text,
    messages,
    schema: replySchema,
    schemaHint: '{"body":"..."}',
  });

  let body = data.body.trim();
  if (body.includes('{saatler}')) {
    const { slots } = await proposeMeeting(deps, msg.companyId);
    body = body.replace(
      '{saatler}',
      slots.length
        ? `\n${slots.map((s) => `• ${formatSlot(s)}`).join('\n')}\n`
        : 'size uygun bir zaman',
    );
  }
  const text = [greetingFor(contact?.full_name ?? null), '', body, '', settings.outreach.signature]
    .join('\n')
    .trim();
  const subject = msg.subject
    ? msg.subject.startsWith('Re:')
      ? msg.subject
      : `Re: ${msg.subject}`
    : `${company.name} hakkında`;
  const touchId = await deps.repo.createTouch({
    company_id: msg.companyId,
    channel: 'email',
    recipient: msg.from,
    subject,
    body: text,
    status: 'awaiting_approval',
    thread_id: msg.threadId,
    contact_id: null,
  });
  const approvalId = await deps.repo.createApproval({
    kind: 'reply',
    title: `Cevap: ${company.name}`,
    payload: {
      text,
      subject,
      personal: body,
      channel: 'email',
      touchId,
      draftKind: 'reply_email',
      warnings: [],
    },
    agent: 'satici',
  });
  await deps.repo.updateTouch(touchId, { approval_id: approvalId });
  await deps.repo.audit(
    'satici.reply_drafted',
    { company_id: msg.companyId, inbox_id: inboxId, redactions: redacted.replaced },
    { type: 'agent', id: 'satici' },
  );
  return approvalId;
}

/** Proposal approvals decided in the panel (approval row only) are applied here by the Worker. */
export async function reconcileProposalDecisions(
  deps: Pick<SalesDeps, 'repo' | 'now'>,
  limit = 5,
): Promise<number> {
  let done = 0;
  for (const p of await deps.repo.proposalsByStatus(['awaiting_approval'], 20)) {
    if (done >= limit) break;
    if (!p.approval_id) continue;
    const a = await deps.repo.getApproval(p.approval_id);
    if (!a || (a.status !== 'approved' && a.status !== 'rejected')) continue;
    await onProposalDecided(deps, a.id, a.status);
    done++;
  }
  return done;
}
