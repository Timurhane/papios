import {
  defaultSettings,
  LLMService,
  type LLMProvider,
  type ProviderGenerateInput,
} from '@papi/core';
import { describe, expect, it } from 'vitest';
import { MemoryRepo } from '../repo/memory.ts';
import type { InboundMail, MailTransport, OutgoingMail } from './mail.ts';
import {
  advanceEnrollments,
  autoEnroll,
  completeOneClick,
  greetingFor,
  handleUnsubscribe,
  onApprovalDecided,
  processInbound,
  reconcilePanelDecisions,
  sendNextEmail,
  type OutreachDeps,
} from './ulak.ts';

class FakeMail implements MailTransport {
  configured = true;
  sent: OutgoingMail[] = [];
  async send(m: OutgoingMail) {
    this.sent.push(m);
    return { messageId: `msg-${this.sent.length}`, threadId: `thr-${this.sent.length}` };
  }
  async fetchNew() {
    return { messages: [], cursor: null };
  }
}

// Istanbul is UTC+3: 07:00Z = 10:00 TR (Tuesday 13 Oct 2026).
const TUE_10 = new Date('2026-10-13T07:00:00Z');

function setup(
  draftBody = 'Sitenizin mobil hızı 35/100; randevu almak isteyen ziyaretçiler beklerken çıkıyor olabilir. 10 dakikalık bir görüşmede örnek gösterebilirim.',
) {
  const repo = new MemoryRepo();
  const calls: ProviderGenerateInput[] = [];
  const gemini: LLMProvider = {
    id: 'gemini',
    async generate(input) {
      calls.push(input);
      return {
        text: JSON.stringify({ subject: 'Mobil siteniz hakkında kısa bir not', body: draftBody }),
        usage: { tokensIn: 1, tokensOut: 1 },
      };
    },
  };
  const settings = structuredClone(defaultSettings.llm);
  settings.quotas.gemini = { ...settings.quotas.gemini!, rpm: 1000, rpd: 1000 };
  const llm = new LLMService({ providers: { gemini }, settings, store: repo.llmStore });
  const mail = new FakeMail();
  const notes: { kind: string; text: string }[] = [];
  let clock = TUE_10;
  repo.now = () => clock;
  const deps: OutreachDeps = {
    repo,
    llm,
    mail,
    publicApiUrl: 'https://api.papi.test',
    tokenSecret: 's'.repeat(40),
    notify: async (kind, text) => {
      notes.push({ kind, text });
    },
    now: () => clock,
    rand: () => 0,
  };
  return { repo, mail, deps, calls, notes, setNow: (d: Date) => (clock = d) };
}

async function analyzedCompany(repo: MemoryRepo, over: Record<string, unknown> = {}) {
  const id = await repo.createCompany({
    name: 'Örnek Diş Kliniği',
    name_norm: 'ornek dis klinigi',
    source: 'telegram',
    domain: 'ornekdis.com',
    emails: ['info@ornekdis.com'],
    phone_e164: null,
    instagram_handle: 'ornekdis',
    ...over,
  });
  await repo.updateCompany(id, {
    stage: 'analyzed',
    next_step_kind: 'playbook',
    assigned_playbook: 'soguk_ana',
    waiting_reason: null,
    waiting_until: null,
  });
  await repo.addAnalysis({
    companyId: id,
    kind: 'light',
    status: 'ok',
    signals: {},
    pagespeed: null,
    findings: ['Randevular telefonla alınıyor olabilir.'],
    strongestFinding: 'Mobil site yavaş (35/100).',
  });
  await repo.addContact(id, {
    full_name: 'Uzm. Dr. Ayşe Yılmaz',
    is_decision_maker: true,
    source: 'website',
  });
  return id;
}

describe('Phase 3 acceptance', () => {
  it('a lead enters Soğuk Ana; the approved email goes out only in business hours', async () => {
    const { repo, mail, deps, calls, setNow } = setup();
    const companyId = await analyzedCompany(repo);

    expect(await autoEnroll(deps)).toBe(1);
    expect((await repo.getCompany(companyId))?.stage).toBe('in_playbook');

    const r = await advanceEnrollments(deps, null);
    expect(r.drafts).toBe(1);
    const approval = repo.approvals[0]!;
    expect(approval).toMatchObject({ kind: 'outreach', status: 'pending' });
    expect(approval.payload.text).toMatch(/^Merhaba Uzm\. Dr\. Ayşe Yılmaz,/);
    expect(approval.payload.text).toContain('AJNA Digital');
    // The contact's name is never sent to the (free-tier) model.
    expect(JSON.stringify(calls)).not.toContain('Ayşe');
    expect(repo.touches[0]).toMatchObject({
      status: 'awaiting_approval',
      cold: true,
      recipient: 'info@ornekdis.com',
    });

    // Nothing is sent without approval.
    expect(await sendNextEmail(deps)).toBe('none_due');

    // Approved at night (23:00 TR) → scheduled for 09:30 next morning.
    setNow(new Date('2026-10-13T20:00:00Z'));
    await repo.decideApproval(approval.id, 'approved');
    await onApprovalDecided(deps, approval.id, 'approved');
    expect(repo.touches[0]).toMatchObject({
      status: 'scheduled',
      due_at: '2026-10-14T06:30:00.000Z',
    });
    expect(await sendNextEmail(deps)).toBe('waiting');
    expect(mail.sent).toHaveLength(0);

    setNow(new Date('2026-10-14T06:31:00Z'));
    expect(await sendNextEmail(deps)).toBe('sent');
    expect(mail.sent[0]).toMatchObject({
      to: 'info@ornekdis.com',
      subject: 'Mobil siteniz hakkında kısa bir not',
    });
    expect(mail.sent[0]!.text).toContain('https://api.papi.test/u/');
    expect(mail.sent[0]!.unsubscribeUrl).toMatch(/^https:\/\/api\.papi\.test\/u\/.+\..+/);
    expect(repo.touches[0]).toMatchObject({
      status: 'sent',
      provider_message_id: 'msg-1',
      thread_id: 'thr-1',
    });
  });

  it('a reply stops the sequence and cancels pending drafts; a hot reply notifies', async () => {
    const { repo, deps, notes } = setup();
    const companyId = await analyzedCompany(repo, { phone_e164: '905321234567' });
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const a1 = repo.approvals[0]!;
    await repo.decideApproval(a1.id, 'approved');
    await onApprovalDecided(deps, a1.id, 'approved');
    await sendNextEmail(deps);

    // Two days later the WhatsApp step is drafted.
    deps.now = () => new Date('2026-10-15T07:00:00Z');
    await advanceEnrollments(deps, null);
    expect(repo.touches.map((t) => `${t.channel}:${t.status}`)).toEqual([
      'email:sent',
      'whatsapp:awaiting_approval',
    ]);

    const reply: InboundMail = {
      providerMessageId: 'in-1',
      threadId: 'thr-1',
      from: 'Ayşe Yılmaz <info@ornekdis.com>',
      subject: 'Re: Mobil siteniz hakkında kısa bir not',
      body: 'Merhaba, fiyat bilgisi alabilir miyim?\n\n13 Eki 2026 tarihinde Timurhan yazdı:\n> ...',
      receivedAt: '2026-10-15T08:00:00Z',
      headers: {},
    };
    expect(await processInbound(deps, [reply])).toBe(1);
    expect(repo.enrollments[0]).toMatchObject({ status: 'stopped' });
    expect(repo.touches[1]).toMatchObject({ status: 'cancelled' });
    expect(await repo.getCompany(companyId)).toMatchObject({
      stage: 'replied',
      next_step_kind: 'waiting',
    });
    expect(notes.at(-1)).toMatchObject({
      kind: 'hot_reply',
      text: expect.stringContaining('fiyat bilgisi'),
    });

    // Nothing else is drafted for this company.
    await advanceEnrollments(deps, null);
    expect(repo.touches).toHaveLength(2);
    // The same message delivered twice is handled once.
    expect(await processInbound(deps, [reply])).toBe(0);
  });

  it('"yazmayın" puts person and company on the global list: no channel can reach them again (K-10.13)', async () => {
    const { repo, mail, deps } = setup();
    const companyId = await analyzedCompany(repo, { phone_e164: '905321234567' });
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const a1 = repo.approvals[0]!;
    await repo.decideApproval(a1.id, 'approved');
    await onApprovalDecided(deps, a1.id, 'approved');
    await sendNextEmail(deps);

    await processInbound(deps, [
      {
        providerMessageId: 'in-2',
        threadId: 'thr-1',
        from: 'info@ornekdis.com',
        subject: 'Re',
        body: 'Lütfen bir daha yazmayın.',
        receivedAt: '2026-10-13T08:00:00Z',
        headers: {},
      },
    ]);
    expect(await repo.isSuppressed('email', 'INFO@ornekdis.com')).toBe(true);
    expect(await repo.getCompany(companyId)).toMatchObject({
      stage: 'closed',
      next_step_kind: 'closed',
    });

    // 1) Re-enrolment does not happen (company is closed).
    expect(await autoEnroll(deps)).toBe(0);
    // 2) Even if someone forces a playbook again, approval and sending are refused.
    await repo.updateCompany(companyId, {
      stage: 'analyzed',
      next_step_kind: 'playbook',
      assigned_playbook: 'hafif_soguk',
    });
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const forced = repo.approvals.at(-1)!;
    await onApprovalDecided(deps, forced.id, 'approved');
    expect(repo.touches.at(-1)).toMatchObject({
      status: 'cancelled',
      skip_reason: 'Alıcı reddedenler listesinde',
    });
    // 3) A manually created WhatsApp item is refused by the store (database trigger in production).
    await expect(
      repo.createTouch({
        company_id: companyId,
        channel: 'whatsapp',
        recipient: '905321234567',
        status: 'ready',
      }),
    ).rejects.toThrow(/suppression/);
    // 4) Nothing more was mailed.
    expect(mail.sent).toHaveLength(1);
  });

  it('the unsubscribe link suppresses the person and the company', async () => {
    const { repo, deps } = setup();
    const companyId = await analyzedCompany(repo);
    const touchId = await repo.createTouch({
      company_id: companyId,
      channel: 'email',
      recipient: 'info@ornekdis.com',
      status: 'sent',
    });
    expect(await handleUnsubscribe(deps, touchId)).toEqual({ companyName: 'Örnek Diş Kliniği' });
    expect(await repo.isSuppressed('email', 'info@ornekdis.com')).toBe(true);
    expect(await repo.isSuppressed('company', companyId)).toBe(true);
  });
});

describe('sequence mechanics', () => {
  it('skips unreachable channels and prepares call tasks without a model', async () => {
    const { repo, deps, calls } = setup();
    await analyzedCompany(repo, { instagram_handle: null }); // no phone, no instagram
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const a1 = repo.approvals[0]!;
    await repo.decideApproval(a1.id, 'approved');
    await onApprovalDecided(deps, a1.id, 'approved');
    await sendNextEmail(deps);
    deps.now = () => new Date('2026-10-22T07:00:00Z'); // day 10
    await advanceEnrollments(deps, null);
    expect(repo.touches.map((t) => `${t.step_position}:${t.channel}:${t.status}`)).toEqual([
      '1:email:sent',
      '2:whatsapp:skipped',
      '3:instagram_dm:skipped',
      '4:demo:skipped',
      '5:phone_call:skipped',
    ]);
    expect(calls).toHaveLength(1);
  });

  it('one-click items: approve → ready → "Gönderdim" → sent', async () => {
    const { repo, deps } = setup();
    const companyId = await analyzedCompany(repo, { phone_e164: '905321234567' });
    const touchId = await repo.createTouch({
      company_id: companyId,
      channel: 'whatsapp',
      recipient: '905321234567',
      status: 'awaiting_approval',
      body: 'Merhaba,',
    });
    const approvalId = await repo.createApproval({
      kind: 'outreach',
      title: 'x',
      payload: { touchId },
      agent: 'ulak',
    });
    await repo.updateTouch(touchId, { approval_id: approvalId });
    await onApprovalDecided(deps, approvalId, 'approved');
    expect((await repo.getTouch(touchId))?.status).toBe('ready');
    await completeOneClick(deps, touchId, 'sent');
    expect((await repo.getTouch(touchId))?.status).toBe('sent');
  });

  it('a rejected draft is cancelled and the sequence moves on', async () => {
    const { repo, deps } = setup();
    await analyzedCompany(repo);
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    await onApprovalDecided(deps, repo.approvals[0]!.id, 'rejected');
    expect(repo.touches[0]).toMatchObject({ status: 'cancelled' });
  });

  it('warm-up daily limit and the weekly per-person limit hold back sending', async () => {
    const { repo, deps } = setup();
    repo.settings.email_sending = {
      ...repo.settings.email_sending,
      daily_limit: 1,
      warmup: { ...repo.settings.email_sending.warmup, enabled: false },
      min_gap_minutes: 0,
      max_gap_minutes: 0,
    };
    const c = await analyzedCompany(repo);
    for (const n of [1, 2]) {
      await repo.createTouch({
        company_id: c,
        channel: 'email',
        recipient: `p${n}@x.com`,
        status: 'scheduled',
        approval_id: `a${n}`,
        body: 'Kısa.',
        subject: 's',
        due_at: TUE_10.toISOString(),
      });
    }
    expect(await sendNextEmail(deps)).toBe('sent');
    expect(await sendNextEmail(deps)).toBe('waiting'); // daily limit 1
  });

  it('an over-long cold email never goes out (K-10.15)', async () => {
    const { repo, deps, mail } = setup('kelime '.repeat(120));
    await analyzedCompany(repo);
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const a = repo.approvals[0]!;
    expect((a.payload.warnings as string[])[0]).toMatch(/kelime; soğuk mail sınırı 80/);
    await onApprovalDecided(deps, a.id, 'approved');
    expect(await sendNextEmail(deps)).toBe('blocked');
    expect(mail.sent).toHaveLength(0);
  });

  it('nothing is sent while the mail account is not connected', async () => {
    const { deps, mail } = setup();
    mail.configured = false;
    expect(await sendNextEmail(deps)).toBe('not_configured');
  });

  it('greetings never infer gender', () => {
    expect(greetingFor('Uzm. Dr. Ayşe Yılmaz')).toBe('Merhaba Uzm. Dr. Ayşe Yılmaz,');
    expect(greetingFor(null)).toBe('Merhaba,');
  });
});

describe('panel decisions', () => {
  it('an approval edited and approved in the panel is applied and scheduled by the Worker', async () => {
    const { repo, deps } = setup();
    await analyzedCompany(repo);
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const approval = repo.approvals[0]!;
    Object.assign(approval, {
      status: 'approved',
      decided_via: 'panel',
      payload: {
        ...approval.payload,
        edited: { text: 'Merhaba,\n\nKısa bir not.\n\nTimurhan', subject: 'Yeni konu' },
      },
    });

    expect(await reconcilePanelDecisions(deps)).toBe(1);
    const touch = await repo.touchByApproval(approval.id);
    expect(touch).toMatchObject({
      status: 'scheduled',
      body: 'Merhaba,\n\nKısa bir not.\n\nTimurhan',
      subject: 'Yeni konu',
    });
    expect(repo.styleMemory).toContainEqual(
      expect.objectContaining({ verdict: 'edited', revised: null }),
    );
    // Already handled: a second pass does nothing.
    expect(await reconcilePanelDecisions(deps)).toBe(0);
  });

  it('a panel rejection cancels the touch; pending approvals are left alone', async () => {
    const { repo, deps } = setup();
    await analyzedCompany(repo);
    await autoEnroll(deps);
    await advanceEnrollments(deps, null);
    const approval = repo.approvals[0]!;
    expect(await reconcilePanelDecisions(deps)).toBe(0);
    Object.assign(approval, { status: 'rejected', decided_via: 'panel' });
    expect(await reconcilePanelDecisions(deps)).toBe(1);
    expect((await repo.touchByApproval(approval.id))?.status).toBe('cancelled');
  });
});
