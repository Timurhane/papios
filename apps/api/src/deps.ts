import {
  AnthropicProvider,
  AJNA_TENANT_ID,
  GeminiProvider,
  GroqProvider,
  LLMService,
  type LLMProvider,
  type ProviderId,
} from '@papi/core';
import type { ConfiguredEnv } from './env.ts';
import { InstagramDiscovery, SupabaseRepo } from '@papi/server';
import type { Repo } from '@papi/server';
import { TelegramClient, type TelegramApi } from '@papi/server';

export interface AppDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
  ownerId: number;
  instagram?: InstagramDiscovery | null;
  pageSpeedKey?: string;
  panelUrl?: string;
  /** Starts the heavy-jobs workflow on GitHub Actions; absent when no dispatch token is configured. */
  dispatchHeavy?: () => Promise<void>;
}

/** Composition root: one set of dependencies per request or cron tick. */
export async function buildDeps(env: ConfiguredEnv): Promise<AppDeps> {
  const repo = new SupabaseRepo(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    env.TENANT_ID ?? AJNA_TENANT_ID,
  );
  const settings = await repo.getSettings();
  const providers: Partial<Record<ProviderId, LLMProvider>> = {};
  if (env.GEMINI_API_KEY) providers.gemini = new GeminiProvider(env.GEMINI_API_KEY);
  if (env.GROQ_API_KEY) providers.groq = new GroqProvider(env.GROQ_API_KEY);
  if (env.ANTHROPIC_API_KEY) providers.anthropic = new AnthropicProvider(env.ANTHROPIC_API_KEY);
  const llm = new LLMService({
    providers,
    settings: settings.llm,
    store: repo.llmStore,
    anthropicEnabled: await repo.getFlag('adapter_anthropic'),
  });
  const instagram =
    env.IG_BUSINESS_ACCOUNT_ID && env.IG_ACCESS_TOKEN
      ? new InstagramDiscovery(
          env.IG_BUSINESS_ACCOUNT_ID,
          env.IG_ACCESS_TOKEN,
          env.IG_GRAPH_VERSION,
        )
      : null;
  const token = env.GITHUB_DISPATCH_TOKEN;
  const repoName = env.GITHUB_REPOSITORY;
  return {
    repo,
    llm,
    tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN),
    ownerId: env.TELEGRAM_OWNER_ID,
    instagram,
    pageSpeedKey: env.PAGESPEED_API_KEY,
    panelUrl: env.PANEL_URL,
    ...(token && repoName ? { dispatchHeavy: () => dispatchWorkflow(token, repoName) } : {}),
  };
}

/** workflow_dispatch for .github/workflows/heavy-jobs.yml on main. */
async function dispatchWorkflow(token: string, repo: string): Promise<void> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/actions/workflows/heavy-jobs.yml/dispatches`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'user-agent': 'papi-worker',
        'x-github-api-version': '2022-11-28',
      },
      body: JSON.stringify({ ref: 'main' }),
    },
  );
  if (!res.ok) throw new Error(`github dispatch failed: ${res.status}`);
}
