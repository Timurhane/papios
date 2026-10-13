import { z } from 'zod';

const optionalSecret = z.string().min(1).optional();

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  TENANT_ID: z.uuid().optional(),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  TELEGRAM_BOT_TOKEN: optionalSecret,
  /** Sent by Telegram in X-Telegram-Bot-Api-Secret-Token (K-17.4). */
  TELEGRAM_WEBHOOK_SECRET: optionalSecret,
  /** Timurhan's numeric Telegram user id (K-15.1). */
  TELEGRAM_OWNER_ID: z.coerce.number().int().positive().optional(),
  GEMINI_API_KEY: optionalSecret,
  GROQ_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  /** Optional; PageSpeed works without a key but is heavily throttled. */
  PAGESPEED_API_KEY: optionalSecret,
  /** Panel base URL for links in Telegram cards. */
  PANEL_URL: z.url().optional(),
  /** Instagram business discovery (K-8.4); off until both are set. */
  IG_BUSINESS_ACCOUNT_ID: optionalSecret,
  IG_ACCESS_TOKEN: optionalSecret,
  IG_GRAPH_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/)
    .optional(),
  /** Optional fine-grained GitHub token (actions:write) to start the heavy-jobs workflow immediately. */
  GITHUB_DISPATCH_TOKEN: optionalSecret,
  /** Public base URL of this Worker (unsubscribe links, K-10.13). */
  PUBLIC_API_URL: z.url().optional(),
  /** Secret (>= 32 chars) for signed public tokens: unsubscribe and demo links (K-17.4). */
  PUBLIC_TOKEN_SECRET: z.string().min(32).optional(),
  /** Google Calendar (K-13.10): OAuth client + refresh token; off until all three are set. */
  GOOGLE_CLIENT_ID: optionalSecret,
  GOOGLE_CLIENT_SECRET: optionalSecret,
  GOOGLE_REFRESH_TOKEN: optionalSecret,
  GOOGLE_CALENDAR_ID: optionalSecret,
  /** Cloudflare Turnstile (K-3.12) for public pages: demo now, analysis tool later. */
  TURNSTILE_SITE_KEY: optionalSecret,
  TURNSTILE_SECRET_KEY: optionalSecret,
  /** Space-separated origins allowed to embed /analiz in an iframe (K-12.1), e.g. https://ajnadigitalagency.com */
  ANALYSIS_EMBED_ORIGINS: z
    .string()
    .regex(/^(https:\/\/[\w.-]+(:\d+)?)( https:\/\/[\w.-]+(:\d+)?)*$/)
    .optional(),
  GITHUB_REPOSITORY: z
    .string()
    .regex(/^[\w.-]+\/[\w.-]+$/)
    .optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: unknown): Env {
  return envSchema.parse(raw);
}

export interface ConfiguredEnv extends Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_OWNER_ID: number;
}

/** Names of required secrets that are missing (never their values). */
export function missingSecrets(env: Env): string[] {
  const required = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_WEBHOOK_SECRET',
    'TELEGRAM_OWNER_ID',
  ] as const;
  return required.filter((k) => env[k] === undefined);
}

export function isConfigured(env: Env): env is ConfiguredEnv {
  return missingSecrets(env).length === 0;
}
