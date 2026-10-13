import { describe, expect, it } from 'vitest';
import { createApp, safeEqual } from './app.ts';
import { OWNER, setup, STRANGER, textUpdate } from './test/fakes.ts';

const env = {
  APP_ENV: 'test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-key',
  TELEGRAM_BOT_TOKEN: 'bot-token',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  TELEGRAM_OWNER_ID: String(OWNER),
};

function post(app: ReturnType<typeof createApp>, body: unknown, secret?: string) {
  return app.request(
    '/telegram/webhook',
    {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
      },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('api', () => {
  it('GET /health reports ok and names (not values of) missing secrets', async () => {
    const res = await createApp().request('/health', {}, { APP_ENV: 'test' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; missing: string[] };
    expect(body.status).toBe('ok');
    expect(body.missing).toContain('TELEGRAM_BOT_TOKEN');
  });

  it('returns 500 without leaking details when env is invalid', async () => {
    const res = await createApp().request('/health', {}, { APP_ENV: 'nope' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal_error' });
  });

  it('webhook rejects a missing or wrong secret token', async () => {
    const ctx = setup();
    const app = createApp({ buildDeps: async () => ctx.deps });
    expect((await post(app, textUpdate(OWNER, 'selam'))).status).toBe(401);
    expect((await post(app, textUpdate(OWNER, 'selam'), 'wrong')).status).toBe(401);
    expect(ctx.tg.sent).toHaveLength(0);
  });

  it('webhook is 503 until configured', async () => {
    const res = await createApp().request(
      '/telegram/webhook',
      { method: 'POST', body: '{}' },
      { APP_ENV: 'test' },
    );
    expect(res.status).toBe(503);
  });

  it('webhook handles the owner and ignores strangers', async () => {
    const ctx = setup(['{"action":"reply","text":"Merhaba Timurhan"}']);
    const app = createApp({ buildDeps: async () => ctx.deps });
    expect((await post(app, textUpdate(STRANGER, 'selam'), 'webhook-secret')).status).toBe(200);
    expect(ctx.tg.sent).toHaveLength(0);
    expect((await post(app, textUpdate(OWNER, 'selam'), 'webhook-secret')).status).toBe(200);
    expect(ctx.tg.texts()).toEqual(['Merhaba Timurhan']);
  });

  it('rejects malformed updates', async () => {
    const app = createApp({ buildDeps: async () => setup().deps });
    expect((await post(app, { hello: 1 }, 'webhook-secret')).status).toBe(400);
  });

  it('safeEqual compares exactly', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
