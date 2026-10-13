import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { defaultSettings } from './defaults.ts';
import { parseSetting, settingKeys, settingsSchemas } from './schema.ts';
import { renderSettingsSeed } from './seed-sql.ts';

describe('settings', () => {
  it('every default value satisfies its schema', () => {
    for (const key of settingKeys) {
      expect(() => parseSetting(key, defaultSettings[key])).not.toThrow();
    }
  });

  it('defaults cover every key', () => {
    expect(Object.keys(defaultSettings).sort()).toEqual(Object.keys(settingsSchemas).sort());
  });

  it('scoring weights add up to 100', () => {
    const { fit, pain, reach } = defaultSettings.scoring.weights;
    expect(fit + pain + reach).toBe(100);
  });

  it('only the analysis tool report may skip approval', () => {
    expect(() => parseSetting('approval_rules', { exempt_kinds: ['cold_email'] })).toThrow();
  });

  it('rejects malformed business hours', () => {
    expect(() =>
      parseSetting('business_hours', { ...defaultSettings.business_hours, start: '9:30' }),
    ).toThrow();
  });

  it('generated seed file is up to date (run `pnpm gen:seed`)', () => {
    const file = readFileSync(
      new URL('../../../../supabase/seed/20_settings.sql', import.meta.url),
      'utf8',
    );
    expect(file).toBe(renderSettingsSeed());
  });
});
