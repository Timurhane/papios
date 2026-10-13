import { describe, expect, it } from 'vitest';
import { readPublicConfig } from './config';

describe('readPublicConfig', () => {
  it('returns null when any value is missing', () => {
    expect(
      readPublicConfig({ VITE_SUPABASE_URL: 'http://x', VITE_SUPABASE_ANON_KEY: 'k' }),
    ).toBeNull();
  });
  it('normalizes the allowed email', () => {
    expect(
      readPublicConfig({
        VITE_SUPABASE_URL: 'http://x',
        VITE_SUPABASE_ANON_KEY: 'k',
        VITE_ALLOWED_EMAIL: ' Owner@Ajna.com ',
      })?.allowedEmail,
    ).toBe('owner@ajna.com');
  });
});
