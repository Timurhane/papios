import { z } from 'zod';

export const envSchema = z.object({
  APP_ENV: z.enum(['development', 'test', 'production']),
  SUPABASE_URL: z.url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1).optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(raw: unknown): Env {
  return envSchema.parse(raw);
}
