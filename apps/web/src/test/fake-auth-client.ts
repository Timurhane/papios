import type { AuthClient } from '@/auth/auth-client';
import type { AuthSnapshot } from '@/auth/auth-step';

/** In-memory AuthClient that mimics Supabase's password + TOTP flow. */
export function createFakeAuthClient(opts: {
  email: string;
  password: string;
  totpCode: string;
  hasFactor?: boolean;
}) {
  let state: AuthSnapshot & { email: string | null } = {
    hasSession: false,
    currentLevel: null,
    hasVerifiedTotp: opts.hasFactor ?? false,
    email: null,
  };
  const listeners = new Set<() => void>();
  const calls = { enroll: 0, verify: 0 };

  const client: AuthClient = {
    async snapshot() {
      return { ...state };
    },
    async signIn(email, password) {
      if (email !== opts.email || password !== opts.password) return 'invalid';
      state = { ...state, hasSession: true, currentLevel: 'aal1', email };
      return 'ok';
    },
    async signOut() {
      state = { ...state, hasSession: false, currentLevel: null, email: null };
    },
    async startTotpEnrollment() {
      calls.enroll += 1;
      return {
        factorId: 'f1',
        qrCode: 'data:image/svg+xml;utf8,<svg/>',
        secret: 'JBSWY3DPEHPK3PXP',
      };
    },
    async verifyTotp(code) {
      calls.verify += 1;
      if (code !== opts.totpCode) return 'invalid';
      state = { ...state, currentLevel: 'aal2', hasVerifiedTotp: true };
      return 'ok';
    },
    onChange(cb) {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
  return { client, calls };
}
