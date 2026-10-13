import { encodeApprovalCallback, encodeTouchCallback, signToken } from '@papi/core';
import {
  type InboundMail,
  type MailTransport,
  type OutgoingMail,
  type OutreachDeps,
} from '@papi/server';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { handleUpdate } from './bot.ts';
import { oneClickMessage, runOutreachStep } from './outreach.ts';
import { callbackUpdate, OWNER, setup } from './test/fakes.ts';

class FakeMail implements MailTransport {
  configured = true;
  sent: OutgoingMail[] = [];
  inbox: InboundMail[] = [];
  async send(m: OutgoingMail) {
    this.sent.push(m);
    return { messageId: `m${this.sent.length}`, threadId: `t${this.sent.length}` };
  }
  async fetchNew() {
    const messages = this.inbox;
    this.inbox = [];
    return { messages, cursor: 'c1' };
  }
}

const SECRET = 'k'.repeat(40);
// Tuesday 13 Oct 2026, 10:00 Istanbul (minute 0 → advance step).
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 13, 7, minute));

function withOutreach(script: string[] = []) {
  const ctx = setup(script);
  const mail = new FakeMail();
  const outreach: OutreachDeps = {
    repo: ctx.repo,
    llm: ctx.llm,
    mail,
    publicApiUrl: 'https://api.test',
    tokenSecret: SECRET,
    now: () => AT(0),
    rand: () => 0,
  };
  return { ...ctx, mail, outreach, deps: { ...ctx.deps, outreach } };
}

async function analyzed(repo: ReturnType<typeof setup>['repo']) {
  const id = await repo.createCompany({
    name: 'Örnek',
    name_norm: 'ornek',
    source: 'telegram',
    domain: 'ornek.com',
    emails: ['info@ornek.com'],
    phone_e164: '905321234567',
  });
  await repo.updateCompany(id, {
    stage: 'analyzed',
    next_step_kind: 'playbook',
    assigned_playbook: 'soguk_ana',
  });
  return id;
}

describe('outreach through the Worker', () => {
  it('cron drafts, Telegram approves, cron sends in business hours', async () => {
    const { repo, tg, mail, outreach, deps } = withOutreach([
      '{"subject":"Kısa not","body":"Mobil siteniz yavaş görünüyor; kısa bir görüşmede örnek gösterebilirim."}',
    ]);
    await analyzed(repo);
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(0))).toBe(
      'advance:1/0/0/0',
    );
    expect(tg.sent[0]?.text).toContain('Onay bekliyor');

    const approval = repo.approvals[0]!;
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: approval.id, op: 'ok' })),
      deps,
    );
    expect(repo.touches[0]).toMatchObject({ status: 'scheduled' });
    expect(repo.styleMemory.at(-1)).toMatchObject({
      draftKind: 'outreach_email',
      verdict: 'approved',
    });
    // style memory keeps only the model-written part, never the greeting with a name
    expect((repo.styleMemory.at(-1) as { original: string }).original).not.toContain('Merhaba');

    outreach.now = () => AT(1);
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(1))).toBe(
      'send:sent',
    );
    expect(mail.sent).toHaveLength(1);
  });

  it('cron reads replies and stops the sequence', async () => {
    const { repo, tg, mail, outreach } = withOutreach();
    const companyId = await analyzed(repo);
    await repo.createEnrollment(companyId, 'pb-soguk-ana', null);
    await repo.createTouch({
      company_id: companyId,
      channel: 'email',
      recipient: 'info@ornek.com',
      status: 'sent',
      thread_id: 't9',
      sent_at: AT(0).toISOString(),
    });
    mail.inbox.push({
      providerMessageId: 'r1',
      threadId: 't9',
      from: 'info@ornek.com',
      subject: 'Re',
      body: 'Görüşebiliriz.',
      receivedAt: AT(2).toISOString(),
      headers: {},
    });
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(2))).toBe(
      'inbox:1',
    );
    expect(repo.enrollments[0]?.status).toBe('stopped');
    expect(repo.state.get('mail_cursor')).toBe('c1');
  });

  it('one-click reminders: link button + Gönderdim; pressing it records the touch', async () => {
    const { repo, tg, outreach, deps } = withOutreach();
    const companyId = await analyzed(repo);
    const id = await repo.createTouch({
      company_id: companyId,
      channel: 'whatsapp',
      recipient: '905321234567',
      status: 'ready',
      body: 'Merhaba, kısa bir not.',
      due_at: AT(0).toISOString(),
    });
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(3))).toBe(
      'oneclick:1',
    );
    const kb = tg.sent[0]?.opts?.keyboard;
    expect(kb?.[0]?.[0]).toMatchObject({
      text: "WhatsApp'ta aç",
      url: expect.stringContaining('https://wa.me/905321234567?text='),
    });
    // reminders are not repeated
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(7))).toBe(
      'oneclick:0',
    );

    await handleUpdate(callbackUpdate(OWNER, encodeTouchCallback(id, 'ok')), deps);
    expect((await repo.getTouch(id))?.status).toBe('sent');
  });

  it('no reminders outside business hours', async () => {
    const { repo, tg, outreach } = withOutreach();
    const companyId = await analyzed(repo);
    await repo.createTouch({
      company_id: companyId,
      channel: 'whatsapp',
      recipient: '905321234567',
      status: 'ready',
      due_at: AT(0).toISOString(),
    });
    const night = new Date(Date.UTC(2026, 9, 13, 20, 3));
    expect(await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, night)).toBe(
      'oneclick:0',
    );
  });

  it('call tasks show the number and an "Aradım" button', () => {
    const m = oneClickMessage(
      {
        id: '11111111-2222-4333-8444-555555555555',
        company_id: 'c',
        contact_id: null,
        enrollment_id: null,
        step_position: 5,
        channel: 'phone_call',
        recipient: '905321234567',
        subject: null,
        body: 'Not',
        status: 'ready',
        skip_reason: null,
        approval_id: null,
        due_at: null,
        sent_at: null,
        provider_message_id: null,
        thread_id: null,
        cold: false,
      },
      'Örnek',
    );
    expect(m.text).toContain('+905321234567');
    expect(m.keyboard[0]?.[0]?.text).toBe('✅ Aradım');
  });
});

describe('unsubscribe link (K-10.13)', () => {
  const env = {
    APP_ENV: 'test',
    SUPABASE_URL: 'http://127.0.0.1:54321',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    TELEGRAM_BOT_TOKEN: 't',
    TELEGRAM_WEBHOOK_SECRET: 'w',
    TELEGRAM_OWNER_ID: String(OWNER),
    PUBLIC_TOKEN_SECRET: SECRET,
  };

  it('GET only asks for confirmation; POST suppresses; tampered tokens are refused', async () => {
    const { repo, deps } = withOutreach();
    const companyId = await analyzed(repo);
    const touchId = await repo.createTouch({
      company_id: companyId,
      channel: 'email',
      recipient: 'info@ornek.com',
      status: 'sent',
    });
    const token = await signToken(SECRET, 'unsubscribe', touchId);
    const app = createApp({ buildDeps: async () => deps });

    const get = await app.request(`/u/${token}`, {}, env);
    expect(get.status).toBe(200);
    expect(await get.text()).toContain('listeden çıkar');
    expect(await repo.isSuppressed('email', 'info@ornek.com')).toBe(false);

    const bad = await app.request(`/u/${token.slice(0, -2)}xx`, { method: 'POST' }, env);
    expect(bad.status).toBe(404);
    expect(await repo.isSuppressed('email', 'info@ornek.com')).toBe(false);

    // RFC 8058 one-click POST from the mail client
    const post = await app.request(
      `/u/${token}`,
      {
        method: 'POST',
        body: 'List-Unsubscribe=One-Click',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      },
      env,
    );
    expect(post.status).toBe(200);
    expect(await post.text()).toContain('Listeden çıkarıldınız');
    expect(await repo.isSuppressed('email', 'info@ornek.com')).toBe(true);
    expect(await repo.isSuppressed('company', companyId)).toBe(true);
  });
});
