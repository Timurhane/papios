import type { ReactNode } from 'react';
import { tr } from '@/i18n/tr';
import { useAuth } from './AuthContext';
import { EnrollTotpPage } from './EnrollTotpPage';
import { LoginPage } from './LoginPage';
import { VerifyTotpPage } from './VerifyTotpPage';

/** Renders the panel only for an aal2 session (K-17.1). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { step } = useAuth();
  switch (step) {
    case 'loading':
      return (
        <div
          className="flex min-h-dvh items-center justify-center text-sm text-muted"
          role="status"
        >
          {tr.loading}
        </div>
      );
    case 'signed_out':
      return <LoginPage />;
    case 'enroll_totp':
      return <EnrollTotpPage />;
    case 'verify_totp':
      return <VerifyTotpPage />;
    case 'ready':
      return <>{children}</>;
  }
}
