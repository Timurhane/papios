import { z } from 'zod';

const secret = z.string().min(1);

export const jobsEnvSchema = z.object({
  SUPABASE_URL: z.url(),
  SUPABASE_SERVICE_ROLE_KEY: secret,
  TENANT_ID: z.uuid().optional(),
  GEMINI_API_KEY: secret.optional(),
  GROQ_API_KEY: secret.optional(),
  PAGESPEED_API_KEY: secret.optional(),
  TELEGRAM_BOT_TOKEN: secret.optional(),
  TELEGRAM_OWNER_ID: z.coerce.number().int().positive().optional(),
  PANEL_URL: z.url().optional(),
  IG_BUSINESS_ACCOUNT_ID: secret.optional(),
  IG_ACCESS_TOKEN: secret.optional(),
  IG_GRAPH_VERSION: z.string().optional(),
  /** Hard stop for one Actions run (minutes budget, K-3.17). */
  MAX_RUN_MINUTES: z.coerce.number().int().min(1).max(60).default(15),
  PLAYWRIGHT_CHROMIUM_PATH: z.string().optional(),
});

export type JobsEnv = z.infer<typeof jobsEnvSchema>;
