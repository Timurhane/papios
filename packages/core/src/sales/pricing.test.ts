import { describe, expect, it } from 'vitest';
import { defaultSettings } from '../settings/defaults.ts';
import { founderDiscountFor, quotePaths, quoteProject } from './pricing.ts';

const pricing = defaultSettings.pricing;
const SISTEM = 2_550_000; // 25.500 TL

describe('quotePaths (K-7.4)', () => {
  it('no setup: list price, 12 months, first month upfront; early exit owes the setup value', () => {
    const { noSetup } = quotePaths(SISTEM, pricing, null);
    expect(noSetup).toMatchObject({
      monthlyKurus: SISTEM,
      setupFeeKurus: 0,
      commitmentMonths: 12,
      dueAtStartKurus: SISTEM,
      commitmentTotalKurus: SISTEM * 12,
      earlyExitSetupKurus: SISTEM,
      discountedMonthlyKurus: null,
    });
  });

  it('setup: one monthly fee as setup, monthly 15% lower, 3 months', () => {
    const { setup } = quotePaths(SISTEM, pricing, null);
    expect(setup).toMatchObject({
      monthlyKurus: 2_167_500,
      setupFeeKurus: SISTEM,
      commitmentMonths: 3,
      dueAtStartKurus: SISTEM + 2_167_500,
      commitmentTotalKurus: SISTEM + 3 * 2_167_500,
      earlyExitSetupKurus: null,
    });
  });

  it('founder discount (K-7.5): setup up to 40% off, first 3 months 20% off', () => {
    const d = founderDiscountFor({
      slotsLeft: 2,
      setupMaxPct: 40,
      setupPct: 40,
      monthlyPct: 20,
      monthlyMonths: 3,
    });
    const { setup, noSetup } = quotePaths(1_750_000, pricing, d);
    expect(setup.setupFeeKurus).toBe(1_050_000);
    expect(setup.discountedMonthlyKurus).toBe(1_190_000); // 14.875 × 0.8
    expect(noSetup.discountedMonthlyKurus).toBe(1_400_000);
    expect(noSetup.dueAtStartKurus).toBe(1_400_000);
    expect(noSetup.commitmentTotalKurus).toBe(3 * 1_400_000 + 9 * 1_750_000);
  });

  it('no founder discount when no slot is left, and never above the maximum', () => {
    const terms = { slotsLeft: 0, setupMaxPct: 40, setupPct: 40, monthlyPct: 20, monthlyMonths: 3 };
    expect(founderDiscountFor(terms)).toBeNull();
    expect(founderDiscountFor({ ...terms, slotsLeft: 1 }, { setupPct: 90 })?.setupPct).toBe(40);
    expect(founderDiscountFor(null)).toBeNull();
  });

  it('rejects non-integer amounts', () => {
    expect(() => quotePaths(10.5, pricing, null)).toThrow();
  });
});

describe('quoteProject (K-7.3 Özel)', () => {
  const custom = { ...pricing.custom_project, daily_rate_kurus: 1_000_000, uncertainty_pct: 20 };

  it('parts × days × daily rate + uncertainty; maintenance 8–10%', () => {
    const q = quoteProject(
      [
        { title: 'Entegrasyon', days: 4 },
        { title: 'Panel', days: 2.5 },
      ],
      custom,
    );
    expect(q).toMatchObject({
      totalDays: 6.5,
      baseKurus: 6_500_000,
      uncertaintyKurus: 1_300_000,
      projectKurus: 7_800_000,
      raisedToMinimum: false,
      maintenanceMinKurus: 624_000,
      maintenanceMaxKurus: 780_000,
    });
  });

  it('never below the minimum project price (50.000 TL)', () => {
    const q = quoteProject([{ title: 'Küçük iş', days: 1 }], custom);
    expect(q.projectKurus).toBe(5_000_000);
    expect(q.raisedToMinimum).toBe(true);
  });

  it('asks for the daily rate when it is not set', () => {
    expect(() => quoteProject([{ title: 'x', days: 1 }], pricing.custom_project)).toThrow(
      /Günlük ücret/,
    );
  });
});
