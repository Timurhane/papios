import { z } from 'zod';

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM');
const pct = z.number().min(0).max(100);
const kurus = z.number().int().nonnegative();

export const llmProviderSchema = z.enum(['gemini', 'groq', 'anthropic']);
export const llmTierSchema = z.enum(['light', 'medium', 'heavy']);

const modelRef = z.object({
  provider: llmProviderSchema,
  /** Provider model id. Aliases such as `gemini-flash-latest` are preferred over pinned versions. */
  model: z.string().min(1).nullable(),
});

const tierRoute = modelRef.extend({ fallback: modelRef.nullable() });

/**
 * Quota bucket. Buckets are named `<provider>` for text generation and `<provider>_<op>` for other
 * operations (e.g. `gemini_embed`, `groq_transcribe`) because providers meter them separately.
 */
const quotaBucket = z.object({
  enabled: z.boolean(),
  /** Requests per minute; null = not configured yet (calls are refused until set). */
  rpm: z.number().int().positive().nullable(),
  /** Requests per day; null = not configured yet. */
  rpd: z.number().int().positive().nullable(),
  /** IANA zone in which the provider resets its daily quota. */
  day_timezone: z.string().min(1),
  /** Free tier: provider may use inputs to improve products, so personal/client data is never sent. */
  free_tier: z.boolean(),
});

/**
 * Every tunable value lives in the `settings` table as (tenant_id, key, value jsonb).
 * This map is the single source of truth for keys and their shapes.
 */
export const settingsSchemas = {
  business_hours: z.object({
    timezone: z.string().min(1),
    /** ISO weekdays, 1 = Monday ... 7 = Sunday. */
    days: z.array(z.number().int().min(1).max(7)).min(1),
    start: hhmm,
    end: hhmm,
  }),
  email_sending: z.object({
    daily_limit: z.number().int().positive(),
    warmup: z.object({
      enabled: z.boolean(),
      increase_by: z.number().int().nonnegative(),
      every_days: z.number().int().positive(),
      max_daily_limit: z.number().int().positive(),
    }),
    min_gap_minutes: z.number().int().nonnegative(),
    max_gap_minutes: z.number().int().positive(),
  }),
  contact_limits: z.object({
    max_touches_per_person_per_week: z.number().int().positive(),
    max_contacts_per_company: z.number().int().positive(),
  }),
  cold_email: z.object({ max_words: z.number().int().positive() }),
  scoring: z.object({
    weights: z.object({
      fit: z.number().int().nonnegative(),
      pain: z.number().int().nonnegative(),
      reach: z.number().int().nonnegative(),
    }),
    thresholds: z.object({
      cold_main: z.number().int().min(0).max(100),
      light_cold: z.number().int().min(0).max(100),
    }),
  }),
  region_priority: z.array(
    z.object({ name: z.string().min(1), priority: z.number().int().positive() }),
  ),
  llm: z.object({
    routing: z.record(llmTierSchema, tierRoute),
    embedding: modelRef.extend({ dimensions: z.number().int().positive() }),
    transcription: modelRef.extend({ language: z.string().min(2) }),
    speech: modelRef.extend({ voice: z.string().min(1).nullable() }),
    quotas: z.record(z.string().regex(/^[a-z]+(_[a-z]+)?$/), quotaBucket),
    cache_ttl_days: z.number().int().positive(),
    /** Agent loop step limit; keeps a Telegram turn inside Workers' subrequest budget. */
    max_agent_steps: z.number().int().min(1).max(8),
  }),
  telegram: z.object({
    /** Reply with synthesized audio too (K-15.2, optional). */
    voice_replies: z.boolean(),
    /** Max approvals per grouped message. */
    approvals_per_message: z.number().int().min(1).max(10),
  }),
  night_shift: z.object({
    /** Optional automatic quiet window if /uyuyorum is forgotten. */
    auto_window: z.object({ start: hhmm, end: hhmm }).nullable(),
    /** In quiet mode, deliver urgent alerts as silent Telegram notifications. */
    urgent_as_silent: z.boolean(),
  }),
  notifications: z.object({
    hot_reply: z.boolean(),
    payment: z.boolean(),
    system_error: z.boolean(),
    approval_pending: z.boolean(),
    daily_report: z.boolean(),
    business_news: z.boolean(),
  }),
  data_retention: z.object({ unwon_personal_data_months: z.number().int().positive() }),
  approval_rules: z.object({
    /** Outbound kinds that skip the approval queue. Only the analysis tool report is allowed. */
    exempt_kinds: z.array(z.literal('analysis_tool_report')),
  }),
  vat: z.object({ mode: z.enum(['unspecified', 'included', 'excluded']) }),
  revenue_target: z.object({ monthly_kurus: kurus.nullable() }),
  analysis_tool: z.object({ daily_limit: z.number().int().positive() }),
  demo: z.object({ ttl_days: z.number().int().positive() }),
  pricing: z.object({
    no_setup_path: z.object({
      commitment_months: z.number().int().positive(),
      first_month_upfront: z.boolean(),
    }),
    setup_path: z.object({
      setup_fee_in_monthly_fees: z.number().positive(),
      monthly_discount_pct: pct,
      commitment_months: z.number().int().positive(),
    }),
    operations_monthly_dev_hours: z.number().int().positive().nullable(),
    custom_project: z.object({
      min_project_kurus: kurus,
      maintenance_pct_min: pct,
      maintenance_pct_max: pct,
      daily_rate_kurus: kurus.nullable(),
      uncertainty_pct: pct.nullable(),
    }),
  }),
} as const;

export type SettingKey = keyof typeof settingsSchemas;
export type SettingValue<K extends SettingKey> = z.infer<(typeof settingsSchemas)[K]>;
export type Settings = { [K in SettingKey]: SettingValue<K> };

export const settingKeys = Object.keys(settingsSchemas) as SettingKey[];

export function parseSetting<K extends SettingKey>(key: K, value: unknown): SettingValue<K> {
  return settingsSchemas[key].parse(value) as SettingValue<K>;
}
