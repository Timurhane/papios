import { Button } from '@/components/ui/button';
import { tr } from '@/i18n/tr';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';
import { TotpCodeForm } from './TotpCodeForm';

export function VerifyTotpPage() {
  const { client, refresh } = useAuth();
  return (
    <AuthLayout title={tr.verify.title} subtitle={tr.verify.subtitle}>
      <TotpCodeForm />
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
