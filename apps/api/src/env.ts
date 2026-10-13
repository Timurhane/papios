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
