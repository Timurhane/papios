import type { SupabaseClient } from '@supabase/supabase-js';
import { isAllowedEmail, type AuthSnapshot } from './auth-step';

export interface TotpEnrollment {
  factorId: string;
  qrCode: string;
  secret: string;
}

/** The slice of Supabase Auth the panel uses. Kept narrow so it is easy to fake in tests. */
export interface AuthClient {
  snapshot(): Promise<AuthSnapshot & { email: string | null }>;
  /** 'not_allowed': not the panel's e-mail; 'invalid': wrong e-mail/password; 'config': the panel's Supabase key is wrong. */
  signIn(email: string, password: string): Promise<'ok' | 'invalid' | 'not_allowed' | 'config'>;
  signOut(): Promise<void>;
  startTotpEnrollment(): Promise<TotpEnrollment>;
  verifyTotp(code: string, factorId?: string): Promise<'ok' | 'invalid'>;
  onChange(cb: () => void): () => void;
}

export function createSupabaseAuthClient(
  supabase: SupabaseClient,
  allowedEmail: string,
): AuthClient {
  const auth = supabase.auth;

  return {
    async snapshot() {
      const { data } = await auth.getSession();
      const session = data.session;
      if (!session)
        return { hasSession: false, currentLevel: null, hasVerifiedTotp: false, email: null };

      // Defense in depth: sign-up is closed server-side, but never show the panel to another account.
      if (!isAllowedEmail(session.user.email, allowedEmail)) {
        await auth.signOut();
        return { hasSession: false, currentLevel: null, hasVerifiedTotp: false, email: null };
      }

      const [aal, factors] = await Promise.all([
        auth.mfa.getAuthenticatorAssuranceLevel(),
        auth.mfa.listFactors(),
      ]);
      if (aal.error) throw aal.error;
      if (factors.error) throw factors.error;
      return {
        hasSession: true,
        currentLevel: aal.data.currentLevel === 'aal2' ? 'aal2' : 'aal1',
        hasVerifiedTotp: factors.data.totp.length > 0,
        email: session.user.email ?? null,
      };
    },

    async signIn(email, password) {
      if (!isAllowedEmail(email, allowedEmail)) return 'not_allowed';
      const { error } = await auth.signInWithPassword({ email, password });
      if (!error) return 'ok';
      // A wrong project key answers 401 "Invalid API key"; wrong credentials answer 400.
      return error.status === 401 || /api key/i.test(error.message) ? 'config' : 'invalid';
    },

    async signOut() {
      await auth.signOut();
    },

    async startTotpEnrollment() {
      // Drop half-finished enrollments so a fresh QR code can be issued.
      const factors = await auth.mfa.listFactors();
      if (factors.error) throw factors.error;
      for (const f of factors.data.all) {
        if (f.factor_type === 'totp' && f.status === 'unverified') {
          await auth.mfa.unenroll({ factorId: f.id });
        }
      }
      const { data, error } = await auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Papi' });
      if (error) throw error;
      return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
    },

    async verifyTotp(code, factorId) {
      let id = factorId;
      if (!id) {
        const factors = await auth.mfa.listFactors();
        if (factors.error) throw factors.error;
        id = factors.data.totp[0]?.id;
      }
      if (!id) return 'invalid';
      const { error } = await auth.mfa.challengeAndVerify({ factorId: id, code });
      return error ? 'invalid' : 'ok';
    },

    onChange(cb) {
      const { data } = auth.onAuthStateChange(() => cb());
      return () => data.subscription.unsubscribe();
    },
  };
}
