import { formatTl } from '@papi/core';
import { useEffect, useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import type { PortalClient, PortalProject } from './portal-client';

const STATUS = { setup: 'Kurulum', active: 'Aktif', paused: 'Durduruldu', ended: 'Bitti' } as const;
const KIND = { setup: 'Kurulum', monthly: 'Aylık', project: 'Proje', other: 'Diğer' } as const;
const METRIC: Record<string, string> = {
  messages: 'Gelen mesaj',
  leads: 'Yakalanan aday',
  appointments: 'Randevu',
  avg_reply_seconds: 'Ortalama cevap (sn)',
};

type View =
  | { kind: 'loading' }
  | { kind: 'login' }
  | { kind: 'closed' }
  | { kind: 'none' }
  | {
      kind: 'project';
      project: PortalProject;
    };

async function resolveView(client: PortalClient): Promise<{ view: View; error?: string }> {
  try {
    if (!(await client.hasSession())) return { view: { kind: 'login' } };
    const p = await client.project();
    if (p === 'closed') {
      await client.signOut();
      return { view: { kind: 'closed' } };
    }
    return { view: p ? { kind: 'project', project: p } : { kind: 'none' } };
  } catch (e) {
    return { view: { kind: 'login' }, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Client portal (K-13.11): separate from the panel; works only while the client_portal flag is on. */
export function PortalApp({ client }: { client: PortalClient }) {
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void resolveView(client).then((v) => {
      if (!active) return;
      if (v.error) setError(v.error);
      setView(v.view);
    });
    return () => {
      active = false;
    };
  }, [client]);

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col gap-4 p-4">
      <h1 className="text-2xl font-semibold tracking-tight">AJNA Digital · Müşteri portalı</h1>
      <ErrorText>{error}</ErrorText>
      {view.kind === 'loading' && <p className="text-sm text-muted">Yükleniyor…</p>}
      {view.kind === 'login' && (
        <Login
          onSubmit={async (email, password) => {
            setError(null);
            if ((await client.signIn(email, password)) === 'invalid')
              return setError('E-posta veya şifre hatalı.');
            const v = await resolveView(client);
            if (v.error) setError(v.error);
            setView(v.view);
          }}
        />
      )}
      {view.kind === 'closed' && (
        <Card className="p-6 text-sm">
          Müşteri portalı şu an kapalı. Sorularınız için bize yazabilirsiniz.
        </Card>
      )}
      {view.kind === 'none' && (
        <Card className="p-6 text-sm">Bu hesaba bağlı bir proje bulunamadı.</Card>
      )}
      {view.kind === 'project' && (
        <ProjectView
          p={view.project}
          onSignOut={async () => {
            await client.signOut();
            setView({ kind: 'login' });
          }}
        />
      )}
    </main>
  );
}

function Login({ onSubmit }: { onSubmit: (email: string, password: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  return (
    <Card className="flex flex-col gap-3 p-6">
      <Input
        aria-label="E-posta"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <Input
        aria-label="Şifre"
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      <Button disabled={!email || !password} onClick={() => void onSubmit(email, password)}>
        Giriş yap
      </Button>
    </Card>
  );
}

function ProjectView({ p, onSignOut }: { p: PortalProject; onSignOut: () => Promise<void> }) {
  const done = p.tasks.filter((t) => t.done).length;
  return (
    <>
      <Card className="flex flex-col gap-1 p-6">
        <h2 className="text-lg font-semibold">{p.name}</h2>
        <p className="text-sm text-muted">
          Durum: {STATUS[p.status]} · Başlangıç {p.started_on}
          {p.contract_end ? ` · Sözleşme sonu ${p.contract_end}` : ''}
        </p>
      </Card>
      <Card className="p-6">
        <h2 className="mb-2 font-semibold">
          Kurulum adımları ({done}/{p.tasks.length})
        </h2>
        <ul className="space-y-1 text-sm" aria-label="Kurulum adımları">
          {p.tasks.map((t) => (
            <li key={t.title}>
              {t.done ? '✅' : '⏳'} {t.title}
            </li>
          ))}
        </ul>
      </Card>
      <Card className="p-6">
        <h2 className="mb-2 font-semibold">Ödemeler</h2>
        <ul className="space-y-1 text-sm" aria-label="Ödemeler">
          {p.payments.map((y) => (
            <li key={`${y.kind}${y.due_on}`} className="flex flex-wrap justify-between gap-2">
              <span>
                {KIND[y.kind]} · {y.due_on} · {formatTl(y.amount_kurus)}
              </span>
              {y.status === 'paid' ? (
                <span className="text-muted">Ödendi</span>
              ) : y.payment_link ? (
                <a className="underline" href={y.payment_link} target="_blank" rel="noreferrer">
                  Öde
                </a>
              ) : (
                <span className="text-muted">Bekliyor</span>
              )}
            </li>
          ))}
        </ul>
      </Card>
      {p.metrics.length > 0 && (
        <Card className="p-6">
          <h2 className="mb-2 font-semibold">Aylık sonuçlar</h2>
          <ul className="space-y-2 text-sm" aria-label="Aylık sonuçlar">
            {p.metrics.map((m) => (
              <li key={m.period}>
                <strong>{m.period.slice(0, 7)}</strong>:{' '}
                {Object.entries(m.metrics)
                  .map(([k, v]) => `${METRIC[k] ?? k} ${v}`)
                  .join(' · ')}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Button variant="ghost" onClick={() => void onSignOut()}>
        Çıkış yap
      </Button>
    </>
  );
}
