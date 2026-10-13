import {
  addDays,
  checkColdEmail,
  checkOutbound,
  classifyReply,
  dailyEmailLimit,
  findBannedPhrases,
  isBusinessTime,
  localDate,
  nextBusinessTime,
  normalizeEmail,
  ONE_CLICK_CHANNELS,
  planStep,
  sendGapMinutes,
  signToken,
  startOfLocalDay,
  stripQuoted,
  TASK_CHANNELS,
  withUnsubscribeFooter,
  type Channel,
  type ChatMessage,
  type LLMService,
  type PlaybookStep,
  type ReplyClass,
  type Settings,
} from '@papi/core';
import { ulakDraft } from '@papi/prompts';
import { z } from 'zod';
import type {
  CompanyRow,
  EnrollmentRow,
  PlaybookWithSteps,
  Repo,
  TouchRow,
} from '../repo/types.ts';
import { createDemo, demoUrl } from './demo.ts';
import type { InboundMail, MailTransport } from './mail.ts';

export interface OutreachDeps {
  repo: Repo;
  llm: LLMService;
  mail: MailTransport;
  /** Public base URL of the Worker, for unsubscribe links. */
  publicApiUrl: string;
  /** Secret for signed public tokens (>= 32 chars). */
  tokenSecret: string;
  notify?: (kind: 'hot_reply' | 'approval_pending' | 'system_error', text: string) => Promise<void>;
  now?: () => Date;
  rand?: () => number;
}

const FINAL = new Set(['sent', 'skipped', 'cancelled', 'failed']);
export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'E-posta',
  whatsapp: 'WhatsApp',
  instagram_dm: 'Instagram DM',
  linkedin: 'LinkedIn',
  x: 'X',
  phone_call: 'Telefon',
  visit: 'Ziyaret',
  demo: 'Demo',
};

const now = (d: OutreachDeps) => d.now?.() ?? new Date();

// --- enrollment -----------------------------------------------------------------------------------

/** Companies with an assigned playbook (K-9.4) start it; nothing goes out without approval (K-2.1). */
export async function autoEnroll(deps: OutreachDeps, limit = 5): Promise<number> {
  let n = 0;
  for (const c of await deps.repo.companiesToEnroll(limit)) {
    const code = c.assigned_playbook;
    if (!code) continue;
    const pb = await deps.repo.getPlaybook(code);
    if (!pb) continue;
    await deps.repo.createEnrollment(c.id, pb.id, null);
    await deps.repo.updateCompany(c.id, { stage: 'in_playbook' });
    await deps.repo.addCompanyEvent(c.id, 'enrolled', `${pb.name} başladı`);
    n++;
  }
  return n;
}

export interface AdvanceResult {
  drafts: number;
  tasks: number;
  skipped: number;
  completed: number;
}

/** K-11.1: moves every active sequence forward; drafts go to the approval queue. */
export async function advanceEnrollments(
  deps: OutreachDeps,
  batchId: string | null = null,
): Promise<AdvanceResult> {
  const settings = await deps.repo.getSettings();
  const result: AdvanceResult = { drafts: 0, tasks: 0, skipped: 0, completed: 0 };
  const t = now(deps);
  const today = localDate(t, settings.business_hours.timezone);
  const founder = await deps.repo.founderSlotsAvailable();

  for (const e of await deps.repo.activeEnrollments(50)) {
    if (result.drafts >= settings.outreach.drafts_per_tick) break;
    const pb = await deps.repo.getPlaybookById(e.playbook_id);
    const company = await deps.repo.getCompany(e.company_id);
    if (!pb || !company) continue;
    let position = e.next_position;

    for (let guard = 0; guard < 12; guard++) {
      const existing = await deps.repo.touchForStep(e.id, position);
      if (existing && !FINAL.has(existing.status)) break; // waiting for approval or sending
      if (existing) {
        position = (existing.step_position ?? position) + 1;
        await deps.repo.updateEnrollment(e.id, { next_position: position });
        continue;
      }
      const plan = planStep(
        pb.steps,
        position,
        localDate(new Date(e.started_at), settings.business_hours.timezone),
        {
          reach: {
            email: company.emails[0] ?? null,
            phone: company.phone_e164,
            instagram: company.instagram_handle,
            linkedin: null,
          },
          facts: await deps.repo.companyFacts(company.id),
          founderSlotsAvailable: founder,
          // client sequences (Müşteri Yaşamı) are anchored to the contract end (Phase 5)
          contractEnd: e.anchor_date,
        },
      );
      if (plan.kind === 'done') {
        await completeEnrollment(deps, e, company, pb, today);
        result.completed++;
        break;
      }
      if (plan.kind === 'skip') {
        await deps.repo.createTouch({
          company_id: company.id,
          enrollment_id: e.id,
          step_position: plan.step.position,
          channel: plan.step.channel,
          status: 'skipped',
          skip_reason: plan.reason,
        });
        result.skipped++;
        continue;
      }
      if (plan.dueDate > today) break;
      const made = await createStepTouch(
        deps,
        settings,
        e,
        pb,
        company,
        plan.step,
        plan.recipient,
        batchId,
      );
      result[made]++;
      if (made === 'drafts') break;
    }
  }
  return result;
}

async function completeEnrollment(
  deps: OutreachDeps,
  e: EnrollmentRow,
  company: CompanyRow,
  pb: PlaybookWithSteps,
  today: string,
) {
  await deps.repo.updateEnrollment(e.id, { status: 'completed' });
  if (company.stage === 'won') {
    // client sequences end quietly; the client's next step belongs to the project (Phase 5)
    await deps.repo.addCompanyEvent(company.id, 'sequence_completed', `${pb.name} tamamlandı`);
    return;
  }
  // K-2.5 + K-11.7: unanswered sequences wait 60 days for "Uyandırma".
  await deps.repo.updateCompany(company.id, {
    stage: 'waitlist',
    next_step_kind: 'waiting',
    assigned_playbook: null,
    waiting_reason: `${pb.name} cevapsız bitti; uyandırma bekliyor`,
    waiting_until: addDays(today, 60),
  });
  await deps.repo.addCompanyEvent(
    company.id,
    'sequence_completed',
    `${pb.name} tamamlandı (cevap yok)`,
  );
}

async function createStepTouch(
  deps: OutreachDeps,
  settings: Settings,
  e: EnrollmentRow,
  pb: PlaybookWithSteps,
  company: CompanyRow,
  step: PlaybookStep,
  recipient: string | null,
  batchId: string | null,
): Promise<keyof AdvanceResult> {
  const base = {
    company_id: company.id,
    enrollment_id: e.id,
    step_position: step.position,
    channel: step.channel,
    recipient,
  };
  if (step.repeat_every_days) {
    // Recurring steps (Müşteri Yaşamı monthly report) are produced by their own scheduler (V-60).
    await deps.repo.createTouch({
      ...base,
      status: 'skipped',
      skip_reason: 'Aylık rapor kendi zamanlayıcısıyla hazırlanır',
    });
    return 'skipped';
  }
  if (step.channel === 'demo')
    return demoStepTouch(deps, settings, pb, company, step, base, batchId);
  if (step.approval_exempt_kind === 'analysis_tool_report') {
    await deps.repo.createTouch({
      ...base,
      status: 'skipped',
      skip_reason: 'Analiz aracı raporu Faz 7’de geliyor',
    });
    return 'skipped';
  }
  if (TASK_CHANNELS.has(step.channel)) {
    // K-10.6: Timurhan calls; Papi prepares the note (rules, no model).
    const analysis = await deps.repo.latestAnalysis(company.id);
    const note = [
      `${CHANNEL_LABEL[step.channel]} — ${company.name}`,
      `Açı: ${step.angle}`,
      analysis?.strongest_finding ? `Ana bulgu: ${analysis.strongest_finding}` : null,
      ...(analysis?.findings ?? []).map((f) => `• ${f}`),
    ]
      .filter(Boolean)
      .join('\n');
    await deps.repo.createTouch({
      ...base,
      status: 'ready',
      body: note,
      due_at: nextBusinessTime(now(deps), settings.business_hours).toISOString(),
    });
    await deps.repo.addCompanyEvent(
      company.id,
      'task',
      `${CHANNEL_LABEL[step.channel]} görevi hazır`,
    );
    return 'tasks';
  }

  const cold =
    step.channel === 'email' &&
    step.position === firstEmailPosition(pb) &&
    settings.outreach.cold_playbooks.includes(pb.code);
  const draft = await writeDraft(deps, settings, company, step, pb, cold);
  const touchId = await deps.repo.createTouch({
    ...base,
    status: 'awaiting_approval',
    subject: draft.subject,
    body: draft.text,
    cold,
  });
  const approvalId = await deps.repo.createApproval({
    kind: 'outreach',
    title: `${CHANNEL_LABEL[step.channel]}: ${company.name} (${pb.name} ${step.position}. adım)`,
    payload: {
      text: draft.text,
      subject: draft.subject,
      personal: draft.personal,
      channel: step.channel,
      touchId,
      warnings: draft.warnings,
      draftKind: `outreach_${step.channel}`,
    },
    batchId,
    agent: 'ulak',
  });
  await deps.repo.updateTouch(touchId, { approval_id: approvalId });
  return 'drafts';
}

/**
 * K-13.7 demo step (Soğuk Ana G7): a 14-day personal demo is created and its link is delivered by
 * e-mail (or WhatsApp one-click when there is no address). The message still needs approval (K-2.1).
 */
async function demoStepTouch(
  deps: OutreachDeps,
  settings: Settings,
  pb: PlaybookWithSteps,
  company: CompanyRow,
  step: PlaybookStep,
  base: {
    company_id: string;
    enrollment_id: string;
    step_position: number;
    recipient: string | null;
  },
  batchId: string | null,
): Promise<keyof AdvanceResult> {
  const email = company.emails[0] ?? null;
  const via: Channel | null = email ? 'email' : company.phone_e164 ? 'whatsapp' : null;
  if (!via) {
    await deps.repo.createTouch({
      ...base,
      channel: 'demo',
      status: 'skipped',
      skip_reason: 'Demo linkini iletecek e-posta veya telefon yok',
    });
    return 'skipped';
  }
  const demo = await createDemo({ repo: deps.repo, now: deps.now }, company.id);
  const url = demoUrl(deps.publicApiUrl, demo.token);
  const draft = await writeDraft(
    deps,
    settings,
    company,
    {
      ...step,
      channel: via,
      angle: `${step.angle}: işletmeye özel 14 günlük mesaj asistanı demosu hazırladık; denemeye davet et. Linki yazma, kod ekler.`,
    },
    pb,
    false,
  );
  const signature = settings.outreach.signature;
  const linkLine = `Demonuz (14 gün açık): ${url}`;
  const text = draft.text.endsWith(signature)
    ? `${draft.text.slice(0, -signature.length).trimEnd()}\n\n${linkLine}\n\n${signature}`
    : `${draft.text}\n\n${linkLine}`;
  const touchId = await deps.repo.createTouch({
    ...base,
    channel: via,
    recipient: via === 'email' ? email : company.phone_e164,
    status: 'awaiting_approval',
    subject: draft.subject,
    body: text,
  });
  const approvalId = await deps.repo.createApproval({
    kind: 'outreach',
    title: `Demo (${CHANNEL_LABEL[via]}): ${company.name} (${pb.name} ${step.position}. adım)`,
    payload: {
      text,
      subject: draft.subject,
      personal: draft.personal,
      channel: via,
      touchId,
      warnings: draft.warnings,
      draftKind: `outreach_${via}`,
    },
    batchId,
    agent: 'ulak',
  });
  await deps.repo.updateTouch(touchId, { approval_id: approvalId });
  return 'drafts';
}

function firstEmailPosition(pb: PlaybookWithSteps): number {
  return pb.steps.find((s) => s.channel === 'email')?.position ?? -1;
}

// --- drafting ------------------------------------------------------------------------------------

const draftSchema = z.object({
  subject: z.string().min(2).max(90).nullable(),
  body: z.string().min(10).max(900),
});

export interface Draft {
  subject: string | null;
  personal: string;
  text: string;
  warnings: string[];
}

/** Greeting from the contact's name: no gender is inferred, titles are kept as written. */
export function greetingFor(fullName: string | null): string {
  return fullName ? `Merhaba ${fullName},` : 'Merhaba,';
}

/**
 * K-2.3 template + personal part: the model writes only the personal body from public facts
 * (K-4.7); greeting, signature and the unsubscribe footer are added by code.
 */
export async function writeDraft(
  deps: Pick<OutreachDeps, 'repo' | 'llm'>,
  settings: Settings,
  company: CompanyRow,
  step: PlaybookStep,
  pb: PlaybookWithSteps,
  cold: boolean,
): Promise<Draft> {
  const [analysis, tone, banned, corrections, contact] = await Promise.all([
    deps.repo.latestAnalysis(company.id),
    deps.repo.toneProfile(),
    deps.repo.bannedPhrases(),
    deps.repo.recentStyleCorrections(`outreach_${step.channel}`, 3),
    deps.repo.primaryContact(company.id),
  ]);
  const system = [
    ulakDraft.text,
    tone.description || tone.dos.length || tone.donts.length
      ? `Ton profili: ${tone.description}\nYap: ${tone.dos.join('; ')}\nYapma: ${tone.donts.join('; ')}`
      : null,
    banned.length ? `Asla kullanma: ${banned.join(', ')}` : null,
    corrections.length
      ? `Geçmiş düzeltmeler (bunlardan ders çıkar):\n${corrections.map((c) => `- Talimat: ${c.instruction ?? 'reddedildi'}`).join('\n')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n\n');

  const facts = {
    kanal: CHANNEL_LABEL[step.channel],
    playbook: pb.name,
    adim: step.position,
    aci: step.angle,
    isletme: company.name,
    sektor: company.sector,
    il: company.city,
    en_guclu_bulgu: analysis?.strongest_finding ?? null,
    bulgular: analysis?.findings ?? [],
    onceki_adimlar: pb.steps
      .filter((s) => s.position < step.position)
      .map((s) => `${CHANNEL_LABEL[s.channel]}: ${s.angle}`),
  };

  const signature = settings.outreach.signature;
  const greeting = greetingFor(contact?.full_name ?? null);
  const compose = (body: string) => [greeting, '', body.trim(), '', signature].join('\n').trim();

  let messages: ChatMessage[] = [{ role: 'user', content: JSON.stringify(facts) }];
  let last: { subject: string | null; body: string } | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data } = await deps.llm.generateStructured({
      agent: 'ulak',
      task: `ulak.draft.${step.channel}`,
      tier: 'medium',
      dataClass: 'internal',
      promptId: ulakDraft.id,
      promptVersion: ulakDraft.version,
      system,
      messages,
      schema: draftSchema,
      schemaHint:
        '{"subject":"<yalnızca e-postada kısa konu, değilse null>","body":"<kişisel gövde>"}',
      noCache: attempt > 0,
    });
    last = data;
    if (!cold || checkColdEmail(compose(data.body), settings.cold_email.max_words).ok) break;
    messages = [
      ...messages,
      { role: 'assistant' as const, content: JSON.stringify(data) },
      {
        role: 'user' as const,
        content: `Çok uzun. Gövdeyi ${settings.cold_email.max_words - 25} kelimenin altına indir.`,
      },
    ];
  }
  const body = last?.body ?? '';
  const text = compose(body);
  const warnings: string[] = [];
  const hits = findBannedPhrases(text, banned);
  if (hits.length) warnings.push(`Yasaklı ifade: ${hits.join(', ')}`);
  if (cold) {
    const c = checkColdEmail(text, settings.cold_email.max_words);
    if (!c.ok)
      warnings.push(`${c.words} kelime; soğuk mail sınırı ${settings.cold_email.max_words}`);
  }
  return {
    subject:
      step.channel === 'email' ? (last?.subject ?? `${company.name} için kısa bir not`) : null,
    personal: body,
    text,
    warnings,
  };
}

// --- approvals → schedule ----------------------------------------------------------------------

/** Called after Timurhan decides an outreach approval (Telegram or panel). */
export async function onApprovalDecided(
  deps: OutreachDeps,
  approvalId: string,
  decision: 'approved' | 'rejected',
): Promise<void> {
  const touch = await deps.repo.touchByApproval(approvalId);
  if (!touch || FINAL.has(touch.status)) return;
  if (decision === 'rejected') {
    await deps.repo.updateTouch(touch.id, {
      status: 'cancelled',
      skip_reason: 'Timurhan reddetti',
    });
    return;
  }
  const settings = await deps.repo.getSettings();
  const when = nextBusinessTime(now(deps), settings.business_hours).toISOString();
  try {
    await deps.repo.updateTouch(touch.id, {
      status: touch.channel === 'email' ? 'scheduled' : 'ready',
      due_at: when,
    });
  } catch (err) {
    // The database refuses suppressed recipients (K-10.13).
    await deps.repo.updateTouch(touch.id, {
      status: 'cancelled',
      skip_reason: 'Alıcı reddedenler listesinde',
    });
    await deps.repo.audit('outreach.blocked_suppressed', {
      touch_id: touch.id,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Approvals decided in the panel (RLS-scoped user session) only change the approval row; the Worker
 * picks them up here: applies a hand edit to the touch, records style memory and schedules or cancels.
 * Telegram decisions are handled inline and never reach this path (their touch has already moved on).
 */
export async function reconcilePanelDecisions(deps: OutreachDeps, limit = 5): Promise<number> {
  const waiting = await deps.repo.touchesByStatus(['awaiting_approval'], 50);
  let done = 0;
  for (const touch of waiting) {
    if (done >= limit) break;
    if (!touch.approval_id) continue;
    const approval = await deps.repo.getApproval(touch.approval_id);
    if (!approval || (approval.status !== 'approved' && approval.status !== 'rejected')) continue;
    const decision = approval.status;
    const edited = editedDraft(approval.payload);
    if (decision === 'approved' && edited) {
      await deps.repo.updateTouch(touch.id, {
        body: edited.text,
        ...(edited.subject !== undefined ? { subject: edited.subject } : {}),
      });
    }
    if (approval.decided_via === 'panel') {
      await deps.repo.addStyleMemory({
        draftKind:
          typeof approval.payload.draftKind === 'string'
            ? approval.payload.draftKind
            : approval.kind,
        original: typeof approval.payload.personal === 'string' ? approval.payload.personal : '',
        // The edited text carries the greeting with the person's name; it never goes to a prompt (K-4.7).
        revised: null,
        instruction: edited && decision === 'approved' ? 'Panelde elle düzenlendi' : null,
        verdict: decision === 'rejected' ? 'rejected' : edited ? 'edited' : 'approved',
      });
    }
    await onApprovalDecided(deps, approval.id, decision);
    done++;
  }
  return done;
}

function editedDraft(
  payload: Record<string, unknown>,
): { text: string; subject?: string | null } | null {
  const e = payload.edited;
  if (!e || typeof e !== 'object') return null;
  const { text, subject } = e as { text?: unknown; subject?: unknown };
  if (typeof text !== 'string' || !text.trim()) return null;
  return {
    text: text.trim(),
    ...(typeof subject === 'string' ? { subject: subject.trim() || null } : {}),
  };
}

// --- sending -------------------------------------------------------------------------------------

export async function unsubscribeUrl(
  deps: Pick<OutreachDeps, 'publicApiUrl' | 'tokenSecret'>,
  touchId: string,
): Promise<string> {
  return `${deps.publicApiUrl.replace(/\/$/, '')}/u/${await signToken(deps.tokenSecret, 'unsubscribe', touchId)}`;
}

async function suppressedFor(repo: Repo, t: TouchRow): Promise<boolean> {
  const kind = (
    {
      email: 'email',
      whatsapp: 'phone',
      phone_call: 'phone',
      instagram_dm: 'instagram',
      linkedin: 'linkedin',
      x: 'x',
    } as Partial<Record<Channel, string>>
  )[t.channel];
  if (kind && t.recipient && (await repo.isSuppressed(kind, t.recipient))) return true;
  if (
    t.channel === 'email' &&
    t.recipient?.includes('@') &&
    (await repo.isSuppressed('domain', t.recipient.split('@')[1] ?? ''))
  )
    return true;
  return repo.isSuppressed('company', t.company_id);
}

export type SendOutcome = 'sent' | 'none_due' | 'waiting' | 'not_configured' | 'blocked';

/** Sends at most one due email per call, respecting business hours, warm-up, gaps and the guard (K-10.*). */
export async function sendNextEmail(deps: OutreachDeps): Promise<SendOutcome> {
  if (!deps.mail.configured) return 'not_configured';
  const settings = await deps.repo.getSettings();
  const t = now(deps);
  if (!isBusinessTime(t, settings.business_hours)) return 'waiting';

  const last = await deps.repo.lastEmailSentAt();
  if (
    last &&
    t.getTime() - Date.parse(last) < sendGapMinutes(settings.email_sending, deps.rand) * 60_000
  )
    return 'waiting';

  const [touch] = (await deps.repo.touchesByStatus(['scheduled'], 10, t)).filter(
    (x) => x.channel === 'email',
  );
  if (!touch) return 'none_due';

  const tz = settings.business_hours.timezone;
  const first = await deps.repo.firstEmailSentAt();
  const limit = dailyEmailLimit(
    settings.email_sending,
    first ? localDate(new Date(first), tz) : null,
    localDate(t, tz),
  );
  const url = await unsubscribeUrl(deps, touch.id);
  const body = withUnsubscribeFooter(touch.body ?? '', url);
  const verdict = checkOutbound(
    {
      channel: 'email',
      recipient: touch.recipient,
      body,
      cold: touch.cold,
      suppressed: await suppressedFor(deps.repo, touch),
      approval: touch.approval_id ? 'approved' : 'none',
      exemptKind: null,
      sentToRecipientLast7Days: touch.recipient
        ? await deps.repo.sentToRecipientLast7Days(touch.recipient)
        : 0,
      sentEmailsToday: await deps.repo.emailsSentSince(startOfLocalDay(t, tz)),
      dailyEmailLimit: limit,
      unsubscribeUrl: url,
      now: t,
    },
    settings,
  );
  if (!verdict.ok) {
    if (verdict.retryLater) return 'waiting';
    await deps.repo.updateTouch(touch.id, {
      status: 'failed',
      skip_reason: verdict.reasons.join('; '),
    });
    await deps.repo.audit('outreach.guard_blocked', {
      touch_id: touch.id,
      reasons: verdict.reasons,
    });
    await deps.notify?.('system_error', `⛔ Gönderim engellendi: ${verdict.reasons.join(', ')}`);
    return 'blocked';
  }

  const sent = await deps.mail.send({
    to: touch.recipient ?? '',
    fromName: settings.outreach.sender_name,
    subject: touch.subject ?? '',
    text: body,
    unsubscribeUrl: url,
    threadId: touch.thread_id,
  });
  await deps.repo.updateTouch(touch.id, {
    status: 'sent',
    sent_at: t.toISOString(),
    body,
    provider_message_id: sent.messageId,
    thread_id: sent.threadId,
  });
  await deps.repo.addCompanyEvent(
    touch.company_id,
    'touch_sent',
    `E-posta gönderildi: ${touch.subject ?? ''}`,
  );
  await deps.repo.audit(
    'outreach.sent',
    { touch_id: touch.id, channel: 'email' },
    { type: 'agent', id: 'ulak' },
  );
  return 'sent';
}

/** K-10.16: Timurhan pressed "Gönderdim" (or skip) on a one-click item or a call/visit task. */
export async function completeOneClick(
  deps: OutreachDeps,
  touchId: string,
  action: 'sent' | 'skip',
): Promise<TouchRow | null> {
  const touch = await deps.repo.getTouch(touchId);
  if (!touch || touch.status !== 'ready') return null;
  if (action === 'skip') {
    await deps.repo.updateTouch(touch.id, { status: 'skipped', skip_reason: 'Timurhan atladı' });
    return touch;
  }
  if (ONE_CLICK_CHANNELS.has(touch.channel) && (await suppressedFor(deps.repo, touch))) {
    await deps.repo.updateTouch(touch.id, {
      status: 'cancelled',
      skip_reason: 'Alıcı reddedenler listesinde',
    });
    return null;
  }
  await deps.repo.updateTouch(touch.id, { status: 'sent', sent_at: now(deps).toISOString() });
  await deps.repo.addCompanyEvent(
    touch.company_id,
    'touch_sent',
    `${CHANNEL_LABEL[touch.channel]} tamamlandı`,
  );
  await deps.repo.audit(
    'outreach.one_click_done',
    { touch_id: touch.id, channel: touch.channel },
    { type: 'agent', id: 'ulak' },
  );
  return touch;
}

// --- inbound -------------------------------------------------------------------------------------

export const REPLY_LABEL: Record<ReplyClass, string> = {
  interested: 'İlgileniyor',
  question: 'Soru',
  later: 'Sonra',
  no: 'Hayır',
  do_not_contact: 'Yazmayın',
  auto_reply: 'Otomatik yanıt',
  unknown: 'Cevap',
};

/** K-10.12/K-10.13/K-13.4: every real reply stops the sequence; "yazmayın" suppresses everywhere. */
export async function processInbound(deps: OutreachDeps, mails: InboundMail[]): Promise<number> {
  let handled = 0;
  const settings = await deps.repo.getSettings();
  const today = localDate(now(deps), settings.business_hours.timezone);
  for (const m of mails) {
    const from = normalizeEmail(m.from.replace(/^.*<([^>]+)>.*$/, '$1')) ?? m.from.toLowerCase();
    const touch = await deps.repo.findTouchForReply(m.threadId, from);
    const cls = classifyReply({ subject: m.subject, body: m.body, headers: m.headers });
    const companyId =
      touch?.company_id ??
      (
        await deps.repo.findCompany({
          domain: from.split('@')[1] ?? null,
          phone: null,
          instagram: null,
          nameNorm: '',
          city: null,
        })
      )?.id ??
      null;
    const stored = await deps.repo.addInboxMessage({
      companyId,
      touchId: touch?.id ?? null,
      channel: 'email',
      providerMessageId: m.providerMessageId,
      threadId: m.threadId,
      from,
      subject: m.subject,
      body: m.body,
      receivedAt: m.receivedAt,
      classification: cls,
    });
    if (!stored || !companyId) continue;
    handled++;
    if (cls === 'auto_reply') continue;

    const company = await deps.repo.getCompany(companyId);
    await deps.repo.stopEnrollments(companyId, `Cevap geldi (${REPLY_LABEL[cls]})`);
    await deps.repo.addCompanyEvent(companyId, 'reply', `Cevap: ${REPLY_LABEL[cls]}`);

    if (cls === 'do_not_contact') {
      await deps.repo.suppress('email', from, 'asked_not_to_contact', 'reply');
      await deps.repo.suppress('company', companyId, 'asked_not_to_contact', 'reply');
      await deps.repo.updateCompany(companyId, { stage: 'closed', next_step_kind: 'closed' });
    } else if (cls === 'no') {
      await deps.repo.updateCompany(companyId, { stage: 'lost', next_step_kind: 'closed' });
    } else if (cls === 'later') {
      const pb = await deps.repo.getPlaybook('simdi_degil');
      if (pb) {
        await deps.repo.createEnrollment(companyId, pb.id, null);
        await deps.repo.updateCompany(companyId, {
          stage: 'in_playbook',
          next_step_kind: 'playbook',
          assigned_playbook: 'simdi_degil',
        });
      } else {
        await deps.repo.updateCompany(companyId, {
          stage: 'waitlist',
          next_step_kind: 'waiting',
          waiting_reason: '"Sonra" dedi',
          waiting_until: addDays(today, 90),
        });
      }
    } else {
      await deps.repo.updateCompany(companyId, {
        stage: 'replied',
        next_step_kind: 'waiting',
        waiting_reason: 'Cevap verdi; Timurhan dönüş yapacak',
        waiting_until: today,
      });
      // Satıcı drafts an answer (redacted input, K-4.9); it arrives in the approval queue.
      await deps.repo.enqueue(
        'satici.reply_draft',
        { inboxId: stored },
        { unique: true, priority: 5 },
      );
      const excerpt = stripQuoted(m.body).slice(0, 400);
      await deps.notify?.(
        'hot_reply',
        `🔥 Sıcak cevap — ${company?.name ?? from} (${REPLY_LABEL[cls]})\n\n"${excerpt}"`,
      );
    }
  }
  return handled;
}

/** Unsubscribe link (K-10.13, K-17.7): the person and their company never receive anything again. */
export async function handleUnsubscribe(
  deps: Pick<OutreachDeps, 'repo'>,
  touchId: string,
): Promise<{ companyName: string | null } | null> {
  const touch = await deps.repo.getTouch(touchId);
  if (!touch) return null;
  if (touch.recipient)
    await deps.repo.suppress(
      touch.channel === 'email' ? 'email' : 'phone',
      touch.recipient,
      'unsubscribe_link',
      'link',
    );
  await deps.repo.suppress('company', touch.company_id, 'unsubscribe_link', 'link');
  await deps.repo.stopEnrollments(touch.company_id, 'Çıkış linki');
  await deps.repo.updateCompany(touch.company_id, { stage: 'closed', next_step_kind: 'closed' });
  await deps.repo.addCompanyEvent(
    touch.company_id,
    'unsubscribed',
    'Çıkış linkine tıklandı; reddedenler listesine alındı',
  );
  const company = await deps.repo.getCompany(touch.company_id);
  return { companyName: company?.name ?? null };
}
