import { defaultSettings, quotePaths } from '@papi/core';
import { DisabledCalendar, type OpsDeps, type SalesDeps } from '@papi/server';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { handleUpdate } from './bot.ts';
import { runPanelAction } from './panel-api.ts';
import { OWNER, setup, textUpdate } from './test/fakes.ts';

const env = {
  APP_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_OWNER_ID: String(OWNER),
};

function withOps() {
  const ctx = setup();
  const ops: OpsDeps = { repo: ctx.repo, publicApiUrl: 'https://api.test' };
  const sales: SalesDeps = {
    repo: ctx.repo,
    llm: ctx.llm,
    calendar: new DisabledCalendar(),
    publicApiUrl: 'https://api.test',
  };
  const deps = {
    ...ctx.deps,
    ops,
    sales,
    publicApiUrl: 'https://api.test',
    panelUrl: 'https://panel.test',
  };
  return { ...ctx, ops, sales, deps };
}

async function sentProposal(repo: ReturnType<typeof setup>['repo']) {
  const companyId = await repo.createCompany({
    name: 'Örnek Diş Kliniği',
    name_norm: 'ornek dis klinigi',
    source: 'telegram',
    emails: ['info@ornekdis.com'],
  });
  const p = await repo.createProposal({
    company_id: companyId,
    package_code: 'refleks',
    status: 'sent',
    vat_mode: 'excluded',
    valid_until: '2026-10-27',
    monthly_kurus: 1_750_000,
    quote: { kind: 'paths', ...quotePaths(1_750_000, defaultSettings.pricing, null) },
  });
  return { companyId, proposalId: p.id };
}

const form = (fields: Record<string, string | string[]>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) for (const x of [v].flat()) fd.append(k, x);
  return fd;
};

describe('Phase 5 acceptance through the panel, the form page and Telegram', () => {
  it('"Kabul edildi" (kurulumlu) → project + form; the client fills the form → prompt ready', async () => {
    const { repo, tg, sales, deps } = withOps();
    const { proposalId } = await sentProposal(repo);
    expect(
      await runPanelAction(sales, 'proposal.close', {
        proposalId,
        outcome: 'accepted',
        path: 'setup',
      }),
    ).toEqual({ ok: true });
    const project = repo.projects[0]!;
    expect(project.payment_path).toBe('setup');
    const token = repo.setupForms[0]!.token;

    const app = createApp({ buildDeps: async () => deps });
    const page = await app.request(`/kurulum/${token}`, {}, env);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain('Örnek Diş Kliniği · Kurulum formu');
    expect(html).toContain('name="channels"');

    const bad = await app.request(
      `/kurulum/${token}`,
      { method: 'POST', body: form({ business_name: 'Örnek' }) },
      env,
    );
    expect(bad.status).toBe(400);
    expect(await bad.text()).toContain('Bu alan zorunlu');

    const ok = await app.request(
      `/kurulum/${token}`,
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
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain('Teşekkürler');
    const prompt = (await repo.artifacts(project.id)).find(
      (a) => a.kind === 'claude_prompt',
    )!.content;
    expect(prompt).toContain('Instagram DM');
    expect(prompt).not.toContain('Kurulum formu henüz gelmedi');
    expect((await app.request(`/kurulum/${token}`, {}, env)).status).toBe(200); // "Form alındı"

    await handleUpdate(textUpdate(OWNER, '/proje Örnek Diş Kliniği'), deps);
    const msg = tg.texts().at(-1) ?? '';
    expect(msg).toContain('Kurulum formu: dolduruldu ✅');
    expect(msg).toContain(`https://panel.test/projeler/${project.id}`);
  });

  it('module metrics need the project token', async () => {
    const { repo, sales, deps } = withOps();
    const { proposalId } = await sentProposal(repo);
    await runPanelAction(sales, 'proposal.close', { proposalId, outcome: 'accepted' });
    const app = createApp({ buildDeps: async () => deps });
    const push = (token: string) =>
      app.request(
        '/metrics/push',
        {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ period: '2026-10-01', metrics: { messages_in: 120 } }),
        },
        env,
      );
    expect((await push('nope'.repeat(11))).status).toBe(401);
    expect((await push(repo.projects[0]!.metrics_token)).status).toBe(200);
    expect(repo.metrics[0]?.metrics).toEqual({ messages_in: 120 });
  });

  it('/not and /tahsilat', async () => {
    const { repo, tg, sales, deps } = withOps();
    const { proposalId } = await sentProposal(repo);
    await runPanelAction(sales, 'proposal.close', { proposalId, outcome: 'accepted' });
    await handleUpdate(textUpdate(OWNER, '/not Klinikler için #randevu fikri'), deps);
    expect(tg.texts().at(-1)).toBe('🗒️ Not kaydedildi (#randevu).');
    await handleUpdate(textUpdate(OWNER, '/tahsilat Örnek Diş Kliniği'), deps);
    expect(tg.texts().at(-1)).toContain('₺17.500');
    expect(repo.payments[0]?.status).toBe('paid');
  });
});
