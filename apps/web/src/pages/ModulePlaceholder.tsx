import { Card } from '@/components/ui/card';
import { tr } from '@/i18n/tr';
import type { PanelModule } from '@/modules';

export function ModulePlaceholder({ module: m }: { module: PanelModule }) {
  const Icon = m.icon;
  return (
    <section>
      <header className="mb-6 flex items-center gap-3">
        <span className="glow flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2">
          <Icon className="h-5 w-5 text-violet" aria-hidden />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{m.label}</h1>
      </header>
      <Card>
        <p className="text-sm text-muted">{m.description}</p>
        <p className="mt-4 inline-flex rounded-full border border-violet/30 bg-violet/10 px-3 py-1 text-xs text-violet">
          {tr.comingSoon} · {tr.comingSoonBody(m.phase)}
        </p>
      </Card>
    </section>
  );
}
