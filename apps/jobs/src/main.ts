import {
  AJNA_TENANT_ID,
  dispatch,
  GeminiProvider,
  GroqProvider,
  LLMService,
  type LLMProvider,
  type ProviderId,
} from '@papi/core';
import { InstagramDiscovery, SupabaseRepo, TelegramClient } from '@papi/server';
import { chromium, type Browser } from 'playwright';
import { jobsEnvSchema } from './env.ts';
import { buildHeavyRegistry } from './handlers.ts';
import { playwrightFetcher } from './render.ts';

/** GitHub Actions entry point: drains heavy jobs until the queue is empty or the time budget runs out. */
async function main() {
  const env = jobsEnvSchema.parse(process.env);
  const repo = new SupabaseRepo(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.TENANT_ID ?? AJNA_TENANT_ID,
  );
  const settings = await repo.getSettings();
  const providers: Partial<Record<ProviderId, LLMProvider>> = {};
  if (env.GEMINI_API_KEY) providers.gemini = new GeminiProvider(env.GEMINI_API_KEY);
  if (env.GROQ_API_KEY) providers.groq = new GroqProvider(env.GROQ_API_KEY);
  const llm = new LLMService({ providers, settings: settings.llm, store: repo.llmStore });

  let browser: Browser | null = null;
  try {
    browser = await chromium.launch(
      env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: env.PLAYWRIGHT_CHROMIUM_PATH } : {},
    );
  } catch (err) {
    console.warn(
      'playwright unavailable, deep crawl disabled:',
      err instanceof Error ? err.message : err,
    );
  }

  const registry = buildHeavyRegistry({
    repo,
    llm,
    tg: env.TELEGRAM_BOT_TOKEN ? new TelegramClient(env.TELEGRAM_BOT_TOKEN) : null,
    ownerChatId: env.TELEGRAM_OWNER_ID ?? null,
    render: browser ? playwrightFetcher(browser) : null,
    pageSpeedKey: env.PAGESPEED_API_KEY,
    panelUrl: env.PANEL_URL,
    instagram:
      env.IG_BUSINESS_ACCOUNT_ID && env.IG_ACCESS_TOKEN
        ? new InstagramDiscovery(
            env.IG_BUSINESS_ACCOUNT_ID,
            env.IG_ACCESS_TOKEN,
            env.IG_GRAPH_VERSION,
          )
        : null,
  });

  const deadline = Date.now() + env.MAX_RUN_MINUTES * 60_000;
  let total = 0;
  try {
    while (Date.now() < deadline) {
      const r = await dispatch({
        store: repo.queueStore,
        registry,
        worker: `actions-${process.env.GITHUB_RUN_ID ?? 'local'}`,
        heavy: true,
        limit: 3,
        onDead: (job, error) =>
          repo.recordError(
            'actions',
            'error',
            `heavy job ${job.type} failed permanently: ${error}`,
            { job_id: job.id },
          ),
      });
      const n = r.done + r.retried + r.dead;
      total += n;
      if (n === 0) break;
    }
  } finally {
    await browser?.close();
  }
  console.log(`processed ${total} heavy job(s)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
