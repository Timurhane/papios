import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthClient } from './auth-client';
import { resolveAuthStep, type AuthStep } from './auth-step';

interface AuthState {
  step: AuthStep;
  email: string | null;
  error: boolean;
  client: AuthClient;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  const [step, setStep] = useState<AuthStep>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const apply = useCallback((snap: Awaited<ReturnType<AuthClient['snapshot']>>) => {
    setEmail(snap.email);
    setStep(resolveAuthStep(snap));
    setError(false);
  }, []);

  const fail = useCallback(() => {
    setError(true);
    setStep('signed_out');
  }, []);

  const refresh = useCallback(() => client.snapshot().then(apply, fail), [client, apply, fail]);

  useEffect(() => {
    let active = true;
    const sync = () => {
      client.snapshot().then(
        (snap) => active && apply(snap),
        () => active && fail(),
      );
    };
    sync();
    const unsubscribe = client.onChange(sync);
    return () => {
      active = false;
      unsubscribe();
    };
  }, [client, apply, fail]);

  const value = useMemo(
    () => ({ step, email, error, client, refresh }),
    [step, email, error, client, refresh],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
