import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { tr } from '@/i18n/tr';
import type { TotpEnrollment } from './auth-client';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { TotpCodeForm } from './TotpCodeForm';

export function EnrollTotpPage() {
  const { client, refresh } = useAuth();
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    client.startTotpEnrollment().then(
      (e) => !cancelled && setEnrollment(e),
      () => !cancelled && setFailed(true),
    );
    return () => {
      cancelled = true;
    };
  }, [client]);

  return (
    <AuthLayout title={tr.enroll.title} subtitle={tr.enroll.subtitle}>
      {failed && <ErrorText>{tr.genericError}</ErrorText>}
      {!enrollment && !failed && <p className="text-sm text-muted">{tr.enroll.preparing}</p>}
      {enrollment && (
        <div className="flex flex-col gap-5">
          <div className="mx-auto rounded-xl bg-white p-3">
            <img src={enrollment.qrCode} alt={tr.enroll.qrAlt} className="h-44 w-44" />
          </div>
          <div className="text-center">
            <p className="text-xs text-muted">{tr.enroll.secretLabel}</p>
            <code className="mt-1 block break-all font-mono text-sm select-all">
              {enrollment.secret}
            </code>
          </div>
          <TotpCodeForm factorId={enrollment.factorId} />
        </div>
      )}
      <Button
        variant="ghost"
        size="sm"
        className="mt-4 w-full"
        onClick={() => void client.signOut().then(refresh)}
      >
        {tr.signOut}
      </Button>
    </AuthLayout>
  );
}
