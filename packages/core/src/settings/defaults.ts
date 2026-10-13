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
  // K-4.3, K-4.4: model ids and limits are filled in Phase 1 after verifying provider docs
  llm: {
    routing: {
      light: { provider: 'gemini', model: null, fallback: { provider: 'groq', model: null } },
      medium: { provider: 'gemini', model: null, fallback: { provider: 'groq', model: null } },
      heavy: { provider: 'gemini', model: null, fallback: { provider: 'groq', model: null } },
    },
    quotas: {
      gemini: { enabled: true, rpm: null, rpd: null, free_tier: true },
      groq: { enabled: true, rpm: null, rpd: null, free_tier: true },
      anthropic: { enabled: false, rpm: null, rpd: null, free_tier: false },
    },
  },
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
