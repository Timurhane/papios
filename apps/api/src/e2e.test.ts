import { dispatch, encodeApprovalCallback } from '@papi/core';
import {
  DisabledCalendar,
  draftMonthlyReports,
  type InboundMail,
  type MailTransport,
  type OpsDeps,
  type OutgoingMail,
  type OutreachDeps,
  type SalesDeps,
} from '@papi/server';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { handleUpdate } from './bot.ts';
import { buildRegistry } from './jobs/handlers.ts';
import { runOutreachStep } from './outreach.ts';
import { runPanelAction } from './panel-api.ts';
import { callbackUpdate, OWNER, setup, textUpdate } from './test/fakes.ts';

/**
 * Phase 7 acceptance: the whole path with fake providers — link → analysis → score → playbook → approval →
 * send → reply → meeting note → proposal → acceptance → project → setup form → monthly report.
 */
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

const env = {
  APP_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_OWNER_ID: String(OWNER),
};

// Tuesday 13 Oct 2026, 10:0x Istanbul.
const AT = (minute: number) => new Date(Date.UTC(2026, 9, 13, 7, minute));

const SUMMARY = JSON.stringify({
  results: [
    {
      id: 'ID',
      sector: 'Diş kliniği',
      city: 'Balıkesir',
      findings: [
        'Randevular telefonla alınıyor olabilir.',
        'WhatsApp yok, sorular gecikebilir.',
        'Mobil site yavaş, ziyaretçi kaçabilir.',
      ],
      strongest_finding: 'Mobil site yavaş olduğu için randevu talepleri kaçıyor olabilir.',
    },
  ],
});
const DRAFT =
  '{"subject":"Kısa not","body":"Mobil siteniz yavaş açılıyor; randevu almak isteyenler beklerken çıkıyor olabilir. 10 dakikalık bir görüşmede örnek gösterebilirim."}';
const NOTES = JSON.stringify({
  summary: 'Instagram mesajlarına geç dönüyorlar.',
  needs: ['Gece gelen mesajlara anında cevap'],
  budget_signal: null,
  objections: [],
  next_step: 'Teklif',
  suggested_package: 'sistem',
});
const PROPOSAL = JSON.stringify({
  intro: 'Gece gelen mesajlar sabaha kalmasın.',
  scope: ['Instagram mesajlarına anında cevap'],
});

const fetchFn = (async (input: string | URL) => {
  const url = String(input);
  if (url.includes('pagespeedonline'))
    return new Response(
      JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.3 } } } }),
    );
  if (!url.startsWith('https://ornekdis.com')) throw new Error('offline');
  const res = new Response(
    '<title>Örnek Diş Kliniği</title><p>Karesi/Balıkesir</p><a href="tel:02661234567">t</a><a href="mailto:info@ornekdis.com">m</a>',
    { headers: { 'content-type': 'text/html' } },
  );
  Object.defineProperty(res, 'url', { value: 'https://ornekdis.com/' });
  return res;
}) as unknown as typeof fetch;

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};

describe('Phase 7 acceptance: end-to-end scenario', () => {
  it('runs a lead from a Telegram link to a delivered client with a monthly report', async () => {
    const ctx = setup([SUMMARY, DRAFT, NOTES, PROPOSAL]);
    const { repo, tg, llm } = ctx;
    // the scripted summary carries the real company id once the company exists
    const realGenerate = llm.generateStructured.bind(llm);
    llm.generateStructured = (async (req: Parameters<typeof realGenerate>[0]) => {
      const out = await realGenerate(req);
      const id = repo.companies[0]?.id ?? 'ID';
      return { ...out, data: JSON.parse(JSON.stringify(out.data).replaceAll('"ID"', `"${id}"`)) };
    }) as typeof llm.generateStructured;

    const mail = new FakeMail();
    let clock = AT(0);
    const outreach: OutreachDeps = {
      repo,
      llm,
      mail,
      publicApiUrl: 'https://api.test',
      tokenSecret: 'k'.repeat(40),
      now: () => clock,
      rand: () => 0,
    };
    const sales: SalesDeps = {
      repo,
      llm,
      calendar: new DisabledCalendar(),
      publicApiUrl: 'https://api.test',
    };
    const ops: OpsDeps = { repo, publicApiUrl: 'https://api.test' };
    const deps = {
      ...ctx.deps,
      outreach,
      sales,
      ops,
      publicApiUrl: 'https://api.test',
      panelUrl: 'https://panel.test',
    };
    const step = (m: number) => {
      clock = AT(m);
      return runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, clock);
    };

    // 1. Telegram link → queued → analysed and scored → playbook
    await handleUpdate(textUpdate(OWNER, '/ekle https://ornekdis.com/'), deps);
    await dispatch({
      store: repo.queueStore,
      registry: buildRegistry({ repo, llm, tg, ownerChatId: OWNER, fetchFn }),
      worker: 'test',
      limit: 1,
    });
    const company = repo.companies[0]!;
    expect(company).toMatchObject({ stage: 'analyzed', next_step_kind: 'playbook' });
    expect(company.score).toBeGreaterThan(0);
    expect(company.emails).toContain('info@ornekdis.com');

    // 2. Sequence drafts the first email → approval in Telegram → sent in business hours
    expect(await step(0)).toMatch(/^advance:1\//);
    const approval = repo.approvals.find((a) => a.kind === 'outreach')!;
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: approval.id, op: 'ok' })),
      deps,
    );
    expect(await step(1)).toBe('panel:0 send:sent');
    expect(mail.sent[0]?.to).toBe('info@ornekdis.com');
    expect(mail.sent[0]?.text).toContain('https://api.test/u/');

    // 3. The reply stops the sequence and is a hot reply
    mail.inbox.push({
      providerMessageId: 'r1',
      threadId: 't1',
      from: 'info@ornekdis.com',
      subject: 'Re: Kısa not',
      body: 'İlgileniyoruz, görüşebiliriz.',
      receivedAt: AT(2).toISOString(),
      headers: {},
    });
    expect(await step(2)).toBe('inbox:1');
    expect(repo.enrollments[0]?.status).toBe('stopped');
    expect(repo.inbox[0]?.classification).toBe('interested');

    // 4. Meeting note → proposal draft → VAT → approval
    await handleUpdate(textUpdate(OWNER, '/gorusme Örnek Diş Kliniği', 2), deps);
    await handleUpdate(
      textUpdate(OWNER, 'Görüştük; Instagram mesajlarına geç dönüyorlar, sistem paketi uygun.', 3),
      deps,
    );
    const vat = tg.sent.at(-1)?.opts?.keyboard?.[0]?.[0] as { callback_data: string };
    await handleUpdate(callbackUpdate(OWNER, vat.callback_data), deps);
    const pa = repo.approvals.find((a) => a.kind === 'proposal')!;
    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: pa.id, op: 'ok' })),
      deps,
    );
    const proposal = repo.proposals[0]!;
    expect(proposal.status).toBe('approved');

    // 5. Sent and accepted (kurulumlu) → project, subscription, setup form
    await runPanelAction(sales, 'proposal.sent', { proposalId: proposal.id });
    await runPanelAction(sales, 'proposal.close', {
      proposalId: proposal.id,
      outcome: 'accepted',
      path: 'setup',
    });
    const project = repo.projects[0]!;
    expect((await repo.getCompany(company.id))?.stage).toBe('won');

    // 6. The client fills the setup form → Claude Code prompt and config are ready
    const app = createApp({ buildDeps: async () => deps });
    const filled = await app.request(
      `/kurulum/${repo.setupForms[0]!.token}`,
      {
        method: 'POST',
        body: form({
          business_name: 'Örnek Diş Kliniği',
          contact_name: 'Ayşe Yılmaz',
          contact_phone: '+90 532 111 22 33',
          contact_email: 'ayse@ornekdis.com',
          hours: 'Hafta içi 09–19',
          services: 'İmplant\nBeyazlatma',
          tone: 'resmi',
          channels: ['web', 'instagram'],
        }),
      },
      env,
    );
    expect(filled.status).toBe(200);
    const artifacts = await repo.artifacts(project.id);
    expect(artifacts.map((a) => a.kind).sort()).toEqual(['checklist', 'claude_prompt', 'config']);

    // 7. The delivered module reports numbers → the monthly report waits for approval
    const pushed = await app.request(
      '/metrics/push',
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${project.metrics_token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ period: '2026-09-01', metrics: { messages_in: 120, leads: 9 } }),
      },
      env,
    );
    expect(pushed.status).toBe(200);
    // the report for last month (September) is prepared in October
    expect(await draftMonthlyReports({ ...ops, now: () => AT(5) })).toBe(1);
    expect(repo.approvals.some((a) => a.title.startsWith('Aylık rapor: Örnek Diş Kliniği'))).toBe(
      true,
    );

    // Every CRM record still has a next step, and the audit log saw the outbound send.
    expect(repo.companies.every((c) => c.next_step_kind)).toBe(true);
    expect(repo.auditLog.some((a) => a.action === 'outreach.sent')).toBe(true);
  });
});

describe('Phase 7 acceptance: analysis tool → Sıcak Gelen', () => {
  it('a form request becomes a warm lead whose sequence starts with a same-day call task', async () => {
    const ctx = setup([SUMMARY]);
    const { repo, tg, llm } = ctx;
    const realGenerate = llm.generateStructured.bind(llm);
    llm.generateStructured = (async (req: Parameters<typeof realGenerate>[0]) => {
      const out = await realGenerate(req);
      const id = repo.companies[0]?.id ?? 'ID';
      return { ...out, data: JSON.parse(JSON.stringify(out.data).replaceAll('"ID"', `"${id}"`)) };
    }) as typeof llm.generateStructured;
    const outreach: OutreachDeps = {
      repo,
      llm,
      mail: new FakeMail(),
      publicApiUrl: 'https://api.test',
      tokenSecret: 'k'.repeat(40),
      now: () => AT(0),
      rand: () => 0,
    };
    const deps = {
      ...ctx.deps,
      tool: { repo, llm, fetchFn, outreach, publicApiUrl: 'https://api.test' },
    };
    const app = createApp({ buildDeps: async () => deps });
    const res = await app.request(
      '/analiz',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          query: 'ornekdis.com',
          email: 'sahibi@ornekdis.com',
          consent: 'yes',
        }).toString(),
      },
      env,
    );
    expect(res.status).toBe(303);
    await dispatch({
      store: repo.queueStore,
      registry: buildRegistry({ repo, llm, tg, ownerChatId: OWNER, tool: deps.tool }),
      worker: 'test',
      limit: 1,
    });
    expect((outreach.mail as FakeMail).sent[0]?.to).toBe('sahibi@ornekdis.com');
    expect(repo.companies[0]?.assigned_playbook).toBe('sicak_gelen');

    await runOutreachStep({ repo, tg, ownerChatId: OWNER, outreach }, AT(0));
    const call = repo.touches.find((t) => t.channel === 'phone_call');
    expect(call?.status).toBe('ready');
    expect(repo.approvals).toHaveLength(0);
  });
});
