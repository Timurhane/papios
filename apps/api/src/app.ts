import type { TgUpdate } from '@papi/core';
import { Hono } from 'hono';
import { handleUpdate } from './bot.ts';
import type { AppDeps } from './deps.ts';
import { isConfigured, missingSecrets, parseEnv, type ConfiguredEnv } from './env.ts';
import {
  applyUnsubscribe,
  unsubscribeConfirmPage,
  unsubscribeDonePage,
  unsubscribeInvalidPage,
} from './unsubscribe.ts';

export type AppBindings = { Bindings: Record<string, unknown> };

export interface AppOptions {
  /** Injected in tests; defaults to the real composition root. */
  buildDeps?: (env: ConfiguredEnv) => Promise<AppDeps>;
}

/** Constant-time string comparison for the webhook secret. */
export function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  let diff = ea.length ^ eb.length;
  for (let i = 0; i < Math.max(ea.length, eb.length); i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0);
  return diff === 0;
}

export function createApp(opts: AppOptions = {}) {
  const app = new Hono<AppBindings>();

  app.get('/health', (c) => {
    const env = parseEnv(c.env ?? {});
    return c.json({
      status: 'ok',
      service: 'papi-api',
      env: env.APP_ENV,
      missing: missingSecrets(env),
    });
  });

  // K-17.4: Telegram webhook is public but authenticated by a secret token header.
  app.post('/telegram/webhook', async (c) => {
    const env = parseEnv(c.env ?? {});
    if (!isConfigured(env)) return c.json({ error: 'not_configured' }, 503);
    const token = c.req.header('x-telegram-bot-api-secret-token') ?? '';
    if (!safeEqual(token, env.TELEGRAM_WEBHOOK_SECRET))
      return c.json({ error: 'unauthorized' }, 401);

    let update: TgUpdate;
    try {
      update = (await c.req.json()) as TgUpdate;
    } catch {
      return c.json({ error: 'bad_request' }, 400);
    }
    if (typeof update?.update_id !== 'number') return c.json({ error: 'bad_request' }, 400);

    const build = opts.buildDeps ?? (await import('./deps.ts')).buildDeps;
    const work = build(env).then((deps) => handleUpdate(update, deps));
    // Answer Telegram immediately; the turn continues in the background.
    const ctx = getExecutionCtx(c);
    if (ctx) ctx.waitUntil(work.catch((err) => console.error('telegram turn failed', err)));
    else await work;
    return c.json({ ok: true });
  });

  // K-10.13 unsubscribe link: public, signed token, no access to anything else (K-17.4).
  app.get('/u/:token', (c) => c.html(unsubscribeConfirmPage()));
  app.post('/u/:token', async (c) => {
    const env = parseEnv(c.env ?? {});
    if (!isConfigured(env) || !env.PUBLIC_TOKEN_SECRET)
      return c.html(unsubscribeInvalidPage(), 503);
    const build = opts.buildDeps ?? (await import('./deps.ts')).buildDeps;
    const deps = await build(env);
    const ok = await applyUnsubscribe(deps.repo, env.PUBLIC_TOKEN_SECRET, c.req.param('token'));
    return ok ? c.html(unsubscribeDonePage()) : c.html(unsubscribeInvalidPage(), 404);
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}

function getExecutionCtx(c: { executionCtx: unknown }): ExecutionContext | null {
  try {
    return c.executionCtx as ExecutionContext;
  } catch {
    return null; // not available in tests
  }
}
