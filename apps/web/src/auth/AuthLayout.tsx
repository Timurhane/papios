import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { tr } from '@/i18n/tr';

export function AuthLayout({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <img src="/logo-placeholder.svg" alt="" className="h-12 w-12" />
          <div>
            <p className="text-gradient text-2xl font-semibold tracking-tight">{tr.appName}</p>
            <p className="mt-1 text-[11px] tracking-[0.3em] text-muted">{tr.tagline}</p>
          </div>
        </div>
        <Card className="glow">
          <h1 className="text-lg font-semibold">{title}</h1>
          <p className="mt-1 mb-6 text-sm text-muted">{subtitle}</p>
          {children}
        </Card>
      </div>
    </main>
  );
}
