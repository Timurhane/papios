import { useState, type FormEvent } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { tr } from '@/i18n/tr';
import { useAuth } from './AuthContext';

export function TotpCodeForm({ factorId }: { factorId?: string }) {
  const { client, refresh } = useAuth();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await client.verifyTotp(code, factorId);
      if (result === 'ok') {
        await refresh();
      } else {
        setError(tr.verify.invalid);
        setCode('');
      }
    } catch {
      setError(tr.genericError);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <Label htmlFor="totp">{tr.verify.code}</Label>
        <Input
          id="totp"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center text-xl tracking-[0.5em]"
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button type="submit" disabled={busy || code.length !== 6}>
        {busy ? tr.verify.submitting : tr.verify.submit}
      </Button>
    </form>
  );
}
