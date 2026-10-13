import { describe, expect, it } from 'vitest';
import { createApp } from './app.ts';
import { runCron } from './cron.ts';
import type { AppDeps } from './deps.ts';
import { OWNER, setup } from './test/fakes.ts';

const env = {
  APP_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_OWNER_ID: String(OWNER),
  ANALYSIS_EMBED_ORIGINS: 'https://ajnadigitalagency.com',
};

const fetchFn = (async (input: string | URL) => {
  const url = String(input);
  if (url.includes('pagespeedonline'))
    return new Response(
      JSON.stringify({ lighthouseResult: { categories: { performance: { score: 0.4 } } } }),
    );
  if (url.startsWith('https://ornekklinik.com')) {
    const res = new Response('<title>Örnek Klinik</title>', {
      headers: { 'content-type': 'text/html' },
    });
    Object.defineProperty(res, 'url', { value: url });
    return res;
  }
  throw new Error(`offline ${url}`);
}) as unknown as typeof fetch;

function withTool() {
  const ctx = setup([]);
  const deps: AppDeps = {
    ...ctx.deps,
    tool: {
      repo: ctx.repo,
      llm: ctx.llm,
      fetchFn,
      publicApiUrl: 'https://api.test',
      notify: async (_k, text) => {
        await ctx.tg.sendMessage(OWNER, text);
      },
    },
  };
  return { ...ctx, deps, app: createApp({ buildDeps: async () => deps }) };
}

const post = (body: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(body).toString(),
});

describe('analysis tool (Worker)', () => {
  it('form → redirect to the report page → job → ready report, embeddable on the AJNA site', async () => {
    const { app, deps, repo, tg } = withTool();
    const form = await app.request('/analiz', {}, env);
    expect(form.status).toBe(200);
    expect(form.headers.get('content-security-policy')).toBe(
      "frame-ancestors 'self' https://ajnadigitalagency.com",
    );
    expect(await form.text()).toContain('Aydınlatma metnini');

    const res = await app.request(
      '/analiz',
      post({ query: 'ornekklinik.com', email: 'sahibi@ornekklinik.com', consent: 'yes' }),
      env,
    );
    expect(res.status).toBe(303);
    const location = res.headers.get('location') ?? '';
    expect(location).toMatch(/^\/analiz\/r\/[\w-]{43}$/);

    const pending = await app.request(location, {}, env);
    expect(await pending.text()).toContain('hazırlanıyor');

    await runCron(deps, new Date('2026-10-13T07:02:00Z'));
    const ready = await (await app.request(location, {}, env)).text();
    expect(ready).toContain('Dijital analiz raporu');
    expect(ready).toContain('Üç somut öneri');
    expect(repo.companies[0]?.assigned_playbook).toBe('sicak_gelen');
    expect(tg.texts().some((t) => t.includes('Sıcak Gelen'))).toBe(true);
  });

  it('requires consent and limits requests per IP', async () => {
    const { app, repo } = withTool();
    const noConsent = await app.request(
      '/analiz',
      post({ query: 'ornekklinik.com', email: 'a@b.com' }),
      env,
    );
    expect(noConsent.status).toBe(400);
    expect(repo.toolRequests).toHaveLength(0);
    const ok = { query: 'ornekklinik.com', email: 'a@b.com', consent: 'yes' };
    for (let i = 0; i < 3; i++)
      expect((await app.request('/analiz', post(ok), env)).status).toBe(303);
    expect((await app.request('/analiz', post(ok), env)).status).toBe(429);
  });

  it('requires Turnstile in production', async () => {
    const { app, repo } = withTool();
    const res = await app.request(
      '/analiz',
      post({ query: 'ornekklinik.com', email: 'a@b.com', consent: 'yes' }),
      { ...env, APP_ENV: 'production' },
    );
    expect(res.status).toBe(403);
    expect(repo.toolRequests).toHaveLength(0);
  });

  it('unknown report links are 404', async () => {
    const { app } = withTool();
    expect((await app.request(`/analiz/r/${'x'.repeat(43)}`, {}, env)).status).toBe(404);
  });

  it('other public pages cannot be framed and are not sniffed', async () => {
    const { app } = withTool();
    const res = await app.request('/demo/unknown', {}, env);
    expect(res.headers.get('content-security-policy')).toBe("frame-ancestors 'none'");
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });
});
