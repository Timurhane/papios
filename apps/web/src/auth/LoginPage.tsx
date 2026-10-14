import { useState, type FormEvent } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tr } from '@/i18n/tr';
import { useAuth } from './AuthContext';
import { AuthLayout } from './AuthLayout';

export function LoginPage() {
  const { client, refresh, error: sessionError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await client.signIn(email, password);
      if (result === 'ok') await refresh();
      else if (result === 'not_allowed') setError(tr.login.notAllowed);
      else if (result === 'config') setError(tr.login.config);
      else setError(tr.login.invalid);
    } catch {
      setError(tr.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={tr.login.title} subtitle={tr.login.subtitle}>
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">{tr.login.email}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">{tr.login.password}</Label>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <ErrorText>{error ?? (sessionError ? tr.genericError : null)}</ErrorText>
        <Button type="submit" disabled={busy}>
          {busy ? tr.login.submitting : tr.login.submit}
        </Button>
      </form>
    </AuthLayout>
  );
}
