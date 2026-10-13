import { describe, expect, it } from 'vitest';
import { isAllowedEmail, resolveAuthStep } from './auth-step';

describe('resolveAuthStep', () => {
  it('no session → sign in', () => {
    expect(resolveAuthStep({ hasSession: false, currentLevel: null, hasVerifiedTotp: false })).toBe(
      'signed_out',
    );
  });
  it('password only, no factor → must enroll TOTP', () => {
    expect(
      resolveAuthStep({ hasSession: true, currentLevel: 'aal1', hasVerifiedTotp: false }),
    ).toBe('enroll_totp');
  });
  it('password only, factor exists → must verify TOTP', () => {
    expect(resolveAuthStep({ hasSession: true, currentLevel: 'aal1', hasVerifiedTotp: true })).toBe(
      'verify_totp',
    );
  });
  it('aal2 → panel', () => {
    expect(resolveAuthStep({ hasSession: true, currentLevel: 'aal2', hasVerifiedTotp: true })).toBe(
      'ready',
    );
  });
});

describe('isAllowedEmail', () => {
  it('matches case-insensitively and trims', () => {
    expect(isAllowedEmail(' Owner@Ajna.com ', 'owner@ajna.com')).toBe(true);
  });
  it('rejects others and empty', () => {
    expect(isAllowedEmail('other@ajna.com', 'owner@ajna.com')).toBe(false);
    expect(isAllowedEmail(null, 'owner@ajna.com')).toBe(false);
  });
});
