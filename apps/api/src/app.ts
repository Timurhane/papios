import { Hono } from 'hono';
import type { Env } from './env.ts';
import { parseEnv } from './env.ts';

export type AppBindings = { Bindings: Record<string, unknown> };

export function createApp() {
  const app = new Hono<AppBindings>();

  app.get('/health', (c) => {
    const env: Env = parseEnv(c.env ?? {});
    return c.json({ status: 'ok', service: 'papi-api', env: env.APP_ENV });
  });

  app.notFound((c) => c.json({ error: 'not_found' }, 404));

  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: 'internal_error' }, 500);
  });

  return app;
}
