export type AuthStep = 'loading' | 'signed_out' | 'enroll_totp' | 'verify_totp' | 'ready';

export interface AuthSnapshot {
  hasSession: boolean;
  /** Authenticator assurance level of the current session. */
  currentLevel: 'aal1' | 'aal2' | null;
  hasVerifiedTotp: boolean;
}

/**
 * K-17.1: the panel opens only for an aal2 (TOTP-verified) session. A user without a verified
 * factor must enroll one first; there is no way to skip it.
 */
export function resolveAuthStep(s: AuthSnapshot): Exclude<AuthStep, 'loading'> {
  if (!s.hasSession) return 'signed_out';
  if (s.currentLevel === 'aal2') return 'ready';
  return s.hasVerifiedTotp ? 'verify_totp' : 'enroll_totp';
}

export function isAllowedEmail(email: string | null | undefined, allowed: string): boolean {
  return !!email && email.trim().toLowerCase() === allowed.trim().toLowerCase();
}
