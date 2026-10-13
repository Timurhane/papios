import { QuotaExhaustedError, type TgUpdate } from '@papi/core';
import { Hono } from 'hono';
import { ZodError } from 'zod';
import { handleUpdate } from './bot.ts';
import { demoExpiredPage, demoNotFoundPage, demoPage, handleDemoChat } from './demo.ts';
import { authenticatePanel, isPanelAction, PanelError, runPanelAction } from './panel-api.ts';
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

  // K-13.7 personal demo: public, unguessable token, reads only its own snapshot (K-17.4).
  app.get('/demo/:token', async (c) => {
    const env = parseEnv(c.env ?? {});
    if (!isConfigured(env)) return c.html(demoNotFoundPage(), 503);
    const deps = await (opts.buildDeps ?? (await import('./deps.ts')).buildDeps)(env);
    const settings = await deps.repo.getSettings();
    const hit = await deps.repo.demoTouch(
      c.req.param('token'),
      'visit',
      settings.demo.messages_per_demo_per_day,
      settings.demo.messages_total_per_day,
    );
    if (hit.result === 'not_found') return c.html(demoNotFoundPage(), 404);
    if (hit.result === 'expired' || !hit.snapshot || !hit.expiresAt)
      return c.html(demoExpiredPage(), 410);
    c.header('cache-control', 'no-store');
    return c.html(
      demoPage({
        businessName: String(hit.snapshot.isletme ?? 'İşletme'),
        expiresAt: hit.expiresAt,
        turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      }),
    );
  });

  app.post('/demo/:token/chat', async (c) => {
    const env = parseEnv(c.env ?? {});
    if (!isConfigured(env)) return c.json({ message: 'Demo şu an kullanılamıyor.' }, 503);
    const deps = await (opts.buildDeps ?? (await import('./deps.ts')).buildDeps)(env);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ message: 'Geçersiz istek.' }, 400);
    }
    const r = await handleDemoChat(
      {
        repo: deps.repo,
        llm: deps.llm,
        turnstileSecret: env.TURNSTILE_SECRET_KEY ?? null,
        requireTurnstile: env.APP_ENV === 'production',
      },
      c.req.param('token'),
      body,
      c.req.header('cf-connecting-ip') ?? null,
    );
    return c.json(r.body, r.status);
  });

  // Panel → Worker actions (user's own session, aal2, tenant member).
  const panelCors = (
    c: { req: { header: (n: string) => string | undefined } },
    env: ReturnType<typeof parseEnv>,
  ) => {
    const origin = c.req.header('origin') ?? '';
    const allowed = [
      env.PANEL_URL ? new URL(env.PANEL_URL).origin : null,
      env.APP_ENV !== 'production' ? 'http://localhost:5173' : null,
    ].filter(Boolean);
    return allowed.includes(origin) ? origin : null;
  };
  app.options('/panel/:action', (c) => {
    const origin = panelCors(c, parseEnv(c.env ?? {}));
    if (!origin) return c.body(null, 403);
    return c.body(null, 204, {
      'access-control-allow-origin': origin,
      'access-control-allow-methods': 'POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'origin',
    });
  });
  app.post('/panel/:action', async (c) => {
    const env = parseEnv(c.env ?? {});
    const origin = panelCors(c, env);
    if (origin) {
      c.header('access-control-allow-origin', origin);
      c.header('vary', 'origin');
    }
    if (!isConfigured(env)) return c.json({ error: 'not_configured' }, 503);
    const action = c.req.param('action');
    if (!isPanelAction(action)) return c.json({ error: 'not_found' }, 404);
    const deps = await (opts.buildDeps ?? (await import('./deps.ts')).buildDeps)(env);
    const userId = await authenticatePanel(
      deps.repo,
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      c.req.header('authorization'),
      deps.fetchImpl,
    );
    if (!userId) return c.json({ error: 'unauthorized' }, 401);
    if (!deps.sales) return c.json({ error: 'not_configured' }, 503);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Geçersiz istek' }, 400);
    }
    try {
      const result = await runPanelAction(
        { ...deps.sales, ...(deps.publicApiUrl ? { publicApiUrl: deps.publicApiUrl } : {}) },
        action,
        body,
      );
      await deps.repo.audit(`panel.${action}`, { user_id: userId });
      return c.json(result);
    } catch (err) {
      if (err instanceof ZodError) return c.json({ error: 'Geçersiz istek' }, 400);
      if (err instanceof QuotaExhaustedError)
        return c.json({ error: 'Yapay zeka kotası dolu; birkaç dakika sonra tekrar dene.' }, 503);
      if (err instanceof PanelError) return c.json({ error: err.message }, err.status);
      await deps.repo.recordError(
        'panel-api',
        'warning',
        err instanceof Error ? err.message : String(err),
        {
          action,
        },
      );
      return c.json({ error: err instanceof Error ? err.message : 'Hata' }, 400);
    }
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
