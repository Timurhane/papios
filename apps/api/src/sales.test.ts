import { encodeApprovalCallback } from '@papi/core';
import { DisabledCalendar, type SalesDeps } from '@papi/server';
import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { handleUpdate } from './bot.ts';
import { callbackUpdate, OWNER, setup, textUpdate, voiceUpdate } from './test/fakes.ts';

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

const env = {
  APP_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_OWNER_ID: String(OWNER),
  PANEL_URL: 'https://panel.test',
};

function withSales(script: string[] = [], transcript = '') {
  const ctx = setup(script, transcript);
  const sales: SalesDeps = { repo: ctx.repo, llm: ctx.llm, calendar: new DisabledCalendar() };
  const deps = {
    ...ctx.deps,
    sales,
    publicApiUrl: 'https://api.test',
    panelUrl: 'https://panel.test',
  };
  return { ...ctx, sales, deps };
}

async function company(repo: ReturnType<typeof setup>['repo']) {
  const id = await repo.createCompany({
    name: 'Örnek Diş Kliniği',
    name_norm: 'ornek dis klinigi',
    source: 'telegram',
    sector: 'Klinik / sağlık',
  });
  await repo.addContact(id, { full_name: 'Ayşe Yılmaz', source: 'website' });
  return id;
}

const b64url = (o: unknown) =>
  btoa(JSON.stringify(o)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const jwt = (claims: Record<string, unknown>) =>
  `${b64url({ alg: 'HS256' })}.${b64url(claims)}.sig`;

describe('Phase 4 acceptance through Telegram', () => {
  it('voice meeting note → proposal draft → VAT answer → approval → panel link for the PDF', async () => {
    const { repo, tg, inputs, deps } = withSales(
      [NOTES, PROPOSAL],
      'Ayşe Hanımla görüştük, Instagram mesajlarına geç dönüyorlar, telefonu 0532 111 22 33.',
    );
    await company(repo);
    await handleUpdate(textUpdate(OWNER, '/gorusme Örnek Diş Kliniği'), deps);
    expect(tg.texts().at(-1)).toContain('görüşme notunu yaz ya da sesli anlat');

    await handleUpdate(voiceUpdate(OWNER), deps);
    // K-4.9: the model only saw the redacted note
    const seen = inputs.map((i) => i.messages.map((m) => m.content).join(' ')).join(' ');
    expect(seen).not.toMatch(/Ayşe|0532/);
    expect(tg.texts().some((t) => t.includes('görüşme notu kaydedildi'))).toBe(true);
    const vatMsg = tg.sent.at(-1)!;
    expect(vatMsg.text).toContain('KDV dahil mi, hariç mi?');
    const vatButton = vatMsg.opts?.keyboard?.[0]?.[0];
    expect(vatButton && 'callback_data' in vatButton).toBe(true);

    await handleUpdate(
      callbackUpdate(OWNER, (vatButton as { callback_data: string }).callback_data),
      deps,
    );
    const approval = repo.approvals.find((a) => a.kind === 'proposal')!;
    expect(approval.title).toMatch(/^Teklif AJNA-2026-0001: Örnek Diş Kliniği — Sistem/);
    expect(repo.proposals[0]).toMatchObject({ status: 'awaiting_approval', vat_mode: 'excluded' });

    await handleUpdate(
      callbackUpdate(OWNER, encodeApprovalCallback({ scope: 'item', id: approval.id, op: 'ok' })),
      deps,
    );
    expect(repo.proposals[0]?.status).toBe('approved');
    expect(tg.texts().at(-1)).toContain(`https://panel.test/teklifler/${repo.proposals[0]?.id}`);
  });

  it('/saat proposes times; the chosen button schedules the meeting', async () => {
    const { repo, tg, deps } = withSales();
    const id = await company(repo);
    await handleUpdate(textUpdate(OWNER, '/saat örnek diş'), deps);
    const msg = tg.sent.at(-1)!;
    expect(msg.text).toContain('takvim bağlı değil');
    const first = msg.opts?.keyboard?.[0]?.[0] as { callback_data: string };
    await handleUpdate(callbackUpdate(OWNER, first.callback_data), deps);
    expect(repo.meetings[0]?.status).toBe('scheduled');
    expect((await repo.getCompany(id))?.stage).toBe('meeting');
  });
});

describe('personal demo (K-13.7)', () => {
  it('/demo gives a link; the page works, chat answers, and it closes after 14 days', async () => {
    const { repo, tg, deps } = withSales([
      'Tabii, yarın 14:00 uygun. Adınızı ve numaranızı alabilir miyim?',
    ]);
    await company(repo);
    await handleUpdate(textUpdate(OWNER, '/demo Örnek Diş Kliniği'), deps);
    const url = /https:\/\/api\.test\/demo\/(\S+)/.exec(tg.texts().at(-1) ?? '');
    expect(url).not.toBeNull();
    const token = url![1]!;
    expect(token.length).toBeGreaterThanOrEqual(43);

    const app = createApp({ buildDeps: async () => deps });
    const page = await app.request(`/demo/${token}`, {}, env);
    expect(page.status).toBe(200);
    expect(await page.text()).toContain('Örnek Diş Kliniği · Mesaj asistanı');

    const chat = await app.request(
      `/demo/${token}/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'Yarın randevu alabilir miyim? Ben Ayşe, 0532 111 22 33' }),
      },
      env,
    );
    expect(chat.status).toBe(200);
    expect(((await chat.json()) as { reply: string }).reply).toContain('yarın 14:00');
    expect(repo.demos[0]?.messages).toBe(1);

    repo.now = () => new Date(Date.now() + 15 * 86_400_000);
    expect((await app.request(`/demo/${token}`, {}, env)).status).toBe(410);
    expect(
      (await app.request('/demo/unknown-token-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', {}, env)).status,
    ).toBe(404);
  });

  it('requires Turnstile in production', async () => {
    const { repo, deps } = withSales();
    const id = await company(repo);
    await repo.createDemo({
      company_id: id,
      token: 't'.repeat(43),
      snapshot: { isletme: 'Örnek' },
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    const app = createApp({ buildDeps: async () => deps });
    const res = await app.request(
      `/demo/${'t'.repeat(43)}/chat`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message: 'merhaba' }),
      },
      { ...env, APP_ENV: 'production' },
    );
    expect(res.status).toBe(403);
    expect(repo.demos[0]?.messages).toBe(0);
  });
});

describe('panel → Worker actions', () => {
  it('rejects missing, aal1 and non-member sessions; accepts an aal2 member', async () => {
    const { repo, deps } = withSales();
    const id = await company(repo);
    const userId = '00000000-0000-4000-8000-00000000aaaa';
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ id: userId }), { status: 200 })) as unknown as typeof fetch;
    const app = createApp({ buildDeps: async () => ({ ...deps, fetchImpl }) });
    const call = (token: string | null) =>
      app.request(
        '/panel/demo.create',
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin: 'https://panel.test',
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ companyId: id }),
        },
        env,
      );
    expect((await call(null)).status).toBe(401);
    expect((await call(jwt({ sub: userId, aal: 'aal1' }))).status).toBe(401);
    expect((await call(jwt({ sub: userId, aal: 'aal2' }))).status).toBe(401); // not a member yet
    repo.members.add(userId);
    const ok = await call(jwt({ sub: userId, aal: 'aal2' }));
    expect(ok.status).toBe(200);
    expect(ok.headers.get('access-control-allow-origin')).toBe('https://panel.test');
    expect(((await ok.json()) as { url: string }).url).toMatch(/^https:\/\/api\.test\/demo\//);
    expect(repo.auditLog.some((a) => a.action === 'panel.demo.create')).toBe(true);
  });

  it('answers the CORS preflight only for the panel origin', async () => {
    const app = createApp();
    const pre = (origin: string) =>
      app.request('/panel/meeting.propose', { method: 'OPTIONS', headers: { origin } }, env);
    expect((await pre('https://panel.test')).status).toBe(204);
    expect((await pre('https://evil.test')).status).toBe(403);
  });
});
