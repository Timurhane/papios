import { createApp } from './app.ts';
import { runCron } from './cron.ts';
import { buildDeps } from './deps.ts';
import { isConfigured, parseEnv } from './env.ts';

const app = createApp();

export default {
  fetch(request: Request, env: Record<string, unknown>, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(
    controller: ScheduledController,
    rawEnv: Record<string, unknown>,
    ctx: ExecutionContext,
  ) {
    const env = parseEnv(rawEnv);
    if (!isConfigured(env)) return;
    ctx.waitUntil(
      buildDeps(env)
        .then((deps) => runCron(deps, new Date(controller.scheduledTime)))
        .catch((err) => console.error('cron failed', err)),
    );
  },
} satisfies ExportedHandler<Record<string, unknown>>;
