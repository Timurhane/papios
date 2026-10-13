import { AuthLayout } from '@/auth/AuthLayout';
import { tr } from '@/i18n/tr';

export function ConfigMissing() {
  return (
    <AuthLayout title={tr.configMissing.title} subtitle={tr.configMissing.body}>
      <></>
    </AuthLayout>
  );
}
