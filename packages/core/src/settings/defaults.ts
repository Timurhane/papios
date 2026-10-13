import type { Settings } from './schema.ts';

/**
 * Default settings seeded for a new tenant. Source of truth for supabase/seed/20_settings.sql
 * (regenerate with `pnpm gen:seed`). Values come from docs/decisions.md; assumptions are marked V-n.
 */
export const defaultSettings: Settings = {
  // K-10.10
  business_hours: {
    timezone: 'Europe/Istanbul',
    days: [1, 2, 3, 4, 5],
    start: '09:30',
    end: '18:00',
  },
  // K-10.9; warmup curve and gaps are assumption V-11
  email_sending: {
    daily_limit: 20,
    warmup: { enabled: true, increase_by: 5, every_days: 7, max_daily_limit: 50 },
    min_gap_minutes: 4,
    max_gap_minutes: 15,
  },
  // K-10.11, K-10.14
  contact_limits: { max_touches_per_person_per_week: 2, max_contacts_per_company: 2 },
  // K-10.15
  cold_email: { max_words: 80 },
  // K-9.3, K-9.4
  scoring: {
    weights: { fit: 40, pain: 40, reach: 20 },
    thresholds: { cold_main: 70, light_cold: 50 },
  },
  // K-9.3
  region_priority: [
    { name: 'Balıkesir', priority: 1 },
    { name: 'Marmara', priority: 2 },
    { name: 'Türkiye', priority: 3 },
  ],
  // K-4.3, K-4.4. Model aliases and conservative limits are assumption V-25: confirm against the
  // AI Studio / Groq console quota pages during live setup.
  llm: {
    routing: {
      light: {
        provider: 'gemini',
        model: 'gemini-flash-lite-latest',
        fallback: { provider: 'groq', model: 'openai/gpt-oss-20b' },
      },
      medium: {
        provider: 'gemini',
        model: 'gemini-flash-latest',
        fallback: { provider: 'groq', model: 'openai/gpt-oss-120b' },
      },
      heavy: {
        provider: 'gemini',
        model: 'gemini-flash-latest',
        fallback: { provider: 'groq', model: 'openai/gpt-oss-120b' },
      },
    },
    embedding: { provider: 'gemini', model: 'gemini-embedding-001', dimensions: 768 },
    transcription: { provider: 'groq', model: 'whisper-large-v3-turbo', language: 'tr' },
    // V-26: Gemini TTS needs no extra account; off until a model id is set.
    speech: { provider: 'gemini', model: null, voice: null },
    quotas: {
      gemini: {
        enabled: true,
        rpm: 10,
        rpd: 250,
        day_timezone: 'America/Los_Angeles',
        free_tier: true,
      },
      gemini_embed: {
        enabled: true,
        rpm: 60,
        rpd: 800,
        day_timezone: 'America/Los_Angeles',
        free_tier: true,
      },
      // K-8.1: grounding with Google Search, free tier shared ~500/day across Flash models (to be confirmed).
      gemini_ground: {
        enabled: true,
        rpm: 5,
        rpd: 100,
        day_timezone: 'America/Los_Angeles',
        free_tier: true,
      },
      gemini_speak: {
        enabled: true,
        rpm: 3,
        rpd: 15,
        day_timezone: 'America/Los_Angeles',
        free_tier: true,
      },
      groq: { enabled: true, rpm: 20, rpd: 1000, day_timezone: 'UTC', free_tier: true },
      groq_transcribe: { enabled: true, rpm: 15, rpd: 1500, day_timezone: 'UTC', free_tier: true },
      anthropic: { enabled: false, rpm: null, rpd: null, day_timezone: 'UTC', free_tier: false },
    },
    cache_ttl_days: 30,
    max_agent_steps: 4,
  },
  // V-41: signature and sender until Timurhan edits them in Settings
  outreach: {
    sender_name: 'Timurhan | AJNA Digital',
    signature: 'Timurhan\nAJNA Digital · ajnadigitalagency.com',
    cold_playbooks: ['soguk_ana', 'hafif_soguk', 'sinyal', 'uyandirma'],
    drafts_per_tick: 2,
  },
  telegram: { voice_replies: false, approvals_per_message: 8 },
  // K-15.5
  night_shift: { auto_window: null, urgent_as_silent: true },
  // K-15.4
  notifications: {
    hot_reply: true,
    payment: true,
    system_error: true,
    approval_pending: true,
    daily_report: true,
    business_news: true,
  },
  // K-17.7
  data_retention: { unwon_personal_data_months: 12 },
  // K-2.2
  approval_rules: { exempt_kinds: ['analysis_tool_report'] },
  // K-7.2
  vat: { mode: 'unspecified' },
  // K-16.1: target set by Timurhan
  revenue_target: { monthly_kurus: null },
  // K-12.5; default value is assumption V-12
  analysis_tool: { daily_limit: 20 },
  // K-13.7
  demo: { ttl_days: 14 },
  // K-7.3, K-7.4
  pricing: {
    no_setup_path: { commitment_months: 12, first_month_upfront: true },
    setup_path: { setup_fee_in_monthly_fees: 1, monthly_discount_pct: 15, commitment_months: 3 },
    operations_monthly_dev_hours: null,
    custom_project: {
      min_project_kurus: 5_000_000,
      maintenance_pct_min: 8,
      maintenance_pct_max: 10,
      daily_rate_kurus: null,
      uncertainty_pct: null,
    },
  },
};
