import type { Kurus } from '../money.ts';
import type { Settings } from '../settings/schema.ts';

type Pricing = Settings['pricing'];

export interface PackageInfo {
  code: string;
  name: string;
  /** null for the custom (project) package. */
  monthlyKurus: Kurus | null;
  startingFrom: boolean;
  hasPaymentPaths: boolean;
}

/** Founder discount actually granted on this proposal (K-7.5). Only when a slot is really free. */
export interface FounderDiscount {
  setupPct: number;
  monthlyPct: number;
  monthlyMonths: number;
}

export interface FounderTerms extends FounderDiscount {
  slotsLeft: number;
  setupMaxPct: number;
}

export interface PathQuote {
  path: 'no_setup' | 'setup';
  /** Regular monthly fee for this path. */
  monthlyKurus: Kurus;
  setupFeeKurus: Kurus;
  commitmentMonths: number;
  /** Monthly fee during the founder discount months, null without a discount. */
  discountedMonthlyKurus: Kurus | null;
  discountedMonths: number;
  /** Due at signing: setup fee and/or the first month. */
  dueAtStartKurus: Kurus;
  /** Everything paid over the commitment period. */
  commitmentTotalKurus: Kurus;
  /** No-setup path: setup value owed (prorated) on early exit (K-7.4). */
  earlyExitSetupKurus: Kurus | null;
}

const pctOf = (v: Kurus, pct: number): Kurus => Math.round((v * pct) / 100);
const minus = (v: Kurus, pct: number): Kurus => v - pctOf(v, pct);

/**
 * K-7.4: the two payment paths side by side.
 * - No setup: list monthly fee, 12-month commitment, first month upfront; early exit owes the setup value.
 * - Setup: one monthly fee as setup, monthly 15 % lower, 3-month commitment.
 * K-7.5 founder discount: up to 40 % off setup, 20 % off the first 3 months.
 */
export function quotePaths(
  monthlyKurus: Kurus,
  pricing: Pricing,
  founder: FounderDiscount | null,
): { noSetup: PathQuote; setup: PathQuote } {
  if (!Number.isInteger(monthlyKurus) || monthlyKurus <= 0)
    throw new RangeError('monthly price must be a positive integer kuruş amount');
  const setupValue = Math.round(monthlyKurus * pricing.setup_path.setup_fee_in_monthly_fees);

  const build = (
    path: PathQuote['path'],
    monthly: Kurus,
    setupFee: Kurus,
    months: number,
    upfrontFirstMonth: boolean,
  ): PathQuote => {
    const dMonths = founder ? Math.min(founder.monthlyMonths, months) : 0;
    const discounted = founder && dMonths > 0 ? minus(monthly, founder.monthlyPct) : null;
    const firstMonth = discounted ?? monthly;
    return {
      path,
      monthlyKurus: monthly,
      setupFeeKurus: setupFee,
      commitmentMonths: months,
      discountedMonthlyKurus: discounted,
      discountedMonths: dMonths,
      dueAtStartKurus: setupFee + (upfrontFirstMonth ? firstMonth : 0),
      commitmentTotalKurus: setupFee + (discounted ?? 0) * dMonths + monthly * (months - dMonths),
      earlyExitSetupKurus: path === 'no_setup' ? setupValue : null,
    };
  };

  const setupFee = founder ? minus(setupValue, founder.setupPct) : setupValue;
  return {
    noSetup: build(
      'no_setup',
      monthlyKurus,
      0,
      pricing.no_setup_path.commitment_months,
      pricing.no_setup_path.first_month_upfront,
    ),
    setup: build(
      'setup',
      minus(monthlyKurus, pricing.setup_path.monthly_discount_pct),
      setupFee,
      pricing.setup_path.commitment_months,
      true,
    ),
  };
}

/** Clamp a requested founder discount to what is allowed and actually available (K-7.5, K-11.5). */
export function founderDiscountFor(
  terms: FounderTerms | null,
  requested: { setupPct?: number } = {},
): FounderDiscount | null {
  if (!terms || terms.slotsLeft <= 0) return null;
  const setupPct = Math.max(
    0,
    Math.min(requested.setupPct ?? terms.setupMaxPct, terms.setupMaxPct),
  );
  return { setupPct, monthlyPct: terms.monthlyPct, monthlyMonths: terms.monthlyMonths };
}

export interface ProjectPart {
  title: string;
  days: number;
}

export interface ProjectQuote {
  totalDays: number;
  baseKurus: Kurus;
  uncertaintyKurus: Kurus;
  projectKurus: Kurus;
  /** True when the formula came out below the minimum project price and was raised to it. */
  raisedToMinimum: boolean;
  maintenanceMinKurus: Kurus;
  maintenanceMaxKurus: Kurus;
}

/** K-7.3 Özel: parts × days × daily rate + uncertainty, never below the minimum project price. */
export function quoteProject(
  parts: ProjectPart[],
  custom: Pricing['custom_project'],
): ProjectQuote {
  if (custom.daily_rate_kurus === null)
    throw new Error('Günlük ücret ayarlanmamış (Ayarlar → Fiyatlar → Özel proje).');
  if (parts.length === 0) throw new Error('En az bir iş parçası gerekli.');
  for (const p of parts)
    if (!(p.days > 0) || p.days > 365) throw new RangeError(`geçersiz gün: ${p.title}`);
  // half-day precision keeps integer arithmetic: work in half days
  const halfDays = parts.reduce((n, p) => n + Math.round(p.days * 2), 0);
  const base = (halfDays * custom.daily_rate_kurus) / 2;
  const uncertainty = pctOf(base, custom.uncertainty_pct ?? 0);
  const formula = Math.round(base) + uncertainty;
  const project = Math.max(formula, custom.min_project_kurus);
  return {
    totalDays: halfDays / 2,
    baseKurus: Math.round(base),
    uncertaintyKurus: uncertainty,
    projectKurus: project,
    raisedToMinimum: project > formula,
    maintenanceMinKurus: pctOf(project, custom.maintenance_pct_min),
    maintenanceMaxKurus: pctOf(project, custom.maintenance_pct_max),
  };
}

export type VatMode = 'included' | 'excluded';

/** Label next to every amount (K-7.2: asked on every proposal while the setting is unspecified). */
export function vatLabel(mode: VatMode): string {
  return mode === 'included' ? 'KDV dahil' : '+ KDV';
}
