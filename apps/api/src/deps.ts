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
import { SupabaseRepo } from './repo/supabase.ts';
import type { Repo } from './repo/types.ts';
import { TelegramClient, type TelegramApi } from './telegram/client.ts';

export interface AppDeps {
  repo: Repo;
  llm: LLMService;
  tg: TelegramApi;
  ownerId: number;
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
  return {
    repo,
    llm,
    tg: new TelegramClient(env.TELEGRAM_BOT_TOKEN),
    ownerId: env.TELEGRAM_OWNER_ID,
  };
}
