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
import {
  DisabledCalendar,
  DisabledMailTransport,
  GoogleCalendar,
  InstagramDiscovery,
  SupabaseRepo,
  type AutomationDeps,
  type CalendarProvider,
  type OpsDeps,
  type OutreachDeps,
  type SalesDeps,
} from '@papi/server';
import { notify } from './notify.ts';
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
  /** Outreach (Phase 3); absent until PUBLIC_API_URL and PUBLIC_TOKEN_SECRET are set. */
  outreach?: OutreachDeps;
  /** Sales (Phase 4): Satıcı, meetings, proposals. Calendar is disabled until Google is connected. */
  sales?: SalesDeps;
  /** Public base URL for demo links; absent until PUBLIC_API_URL is set. */
  publicApiUrl?: string;
  /** Operations (Phase 5): projects, setup forms, finance, reports. */
  ops?: OpsDeps;
  /** Phase 6: routines, night shift, signals, Kalem, learning. */
  automation?: AutomationDeps;
  /** Injected in tests for outbound calls made by route handlers (Supabase Auth check). */
  fetchImpl?: typeof fetch;
}

export function buildCalendar(env: ConfiguredEnv): CalendarProvider {
  return env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_REFRESH_TOKEN
    ? new GoogleCalendar({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: env.GOOGLE_REFRESH_TOKEN,
        ...(env.GOOGLE_CALENDAR_ID ? { calendarId: env.GOOGLE_CALENDAR_ID } : {}),
      })
    : new DisabledCalendar();
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
  const tg = new TelegramClient(env.TELEGRAM_BOT_TOKEN);
  const outreach: OutreachDeps | undefined =
    env.PUBLIC_API_URL && env.PUBLIC_TOKEN_SECRET
      ? {
          repo,
          llm,
          // Mail account connection follows decision A-1; until then nothing is sent or read.
          mail: new DisabledMailTransport(),
          publicApiUrl: env.PUBLIC_API_URL,
          tokenSecret: env.PUBLIC_TOKEN_SECRET,
          notify: async (kind, text) => {
            await notify({ repo, tg, ownerChatId: env.TELEGRAM_OWNER_ID }, kind, text);
          },
        }
      : undefined;
  const opsNotify: OpsDeps['notify'] = async (kind, text) => {
    await notify({ repo, tg, ownerChatId: env.TELEGRAM_OWNER_ID }, kind, text);
  };
  const token = env.GITHUB_DISPATCH_TOKEN;
  const repoName = env.GITHUB_REPOSITORY;
  const dispatchHeavy = token && repoName ? () => dispatchWorkflow(token, repoName) : undefined;
  const ops: OpsDeps = {
    repo,
    ...(env.PUBLIC_API_URL ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
    notify: opsNotify,
  };
  return {
    repo,
    llm,
    tg,
    ownerId: env.TELEGRAM_OWNER_ID,
    instagram,
    ...(outreach ? { outreach } : {}),
    sales: {
      repo,
      llm,
      calendar: buildCalendar(env),
      ...(env.PUBLIC_API_URL ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
      notify: opsNotify,
    },
    ops,
    automation: {
      repo,
      llm,
      ops,
      notify: async (kind, text) => {
        await notify({ repo, tg, ownerChatId: env.TELEGRAM_OWNER_ID }, kind, text);
      },
      ...(env.PANEL_URL ? { panelUrl: env.PANEL_URL } : {}),
      ...(dispatchHeavy ? { dispatchHeavy } : {}),
    },
    ...(env.PUBLIC_API_URL ? { publicApiUrl: env.PUBLIC_API_URL } : {}),
    pageSpeedKey: env.PAGESPEED_API_KEY,
    panelUrl: env.PANEL_URL,
    ...(dispatchHeavy ? { dispatchHeavy } : {}),
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
