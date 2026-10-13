import { formatTl, vatLabel, type PathQuote, type ProjectQuote, type VatMode } from '@papi/core';

type Quote =
  | { kind: 'paths'; noSetup: PathQuote; setup: PathQuote }
  | { kind: 'project'; parts: { title: string; days: number }[]; project: ProjectQuote };

export function asQuote(q: Record<string, unknown>): Quote | null {
  if (q.kind === 'paths' && q.noSetup && q.setup) return q as unknown as Quote;
  if (q.kind === 'project' && q.project) return q as unknown as Quote;
  return null;
}

/** K-13.6: both payment paths side by side, or the project breakdown. */
export function QuoteView({ quote, vat }: { quote: Quote; vat: VatMode | null }) {
  const v = vat ? vatLabel(vat) : 'KDV seçilmedi';
  if (quote.kind === 'project')
    return (
      <div className="rounded-xl border border-border p-4 text-sm">
        <ul className="space-y-1">
          {quote.parts.map((p) => (
            <li key={p.title} className="flex justify-between">
              <span>{p.title}</span>
              <span className="tabular-nums">{p.days} gün</span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-lg font-semibold text-violet">
          {formatTl(quote.project.projectKurus)} <span className="text-xs text-muted">{v}</span>
        </p>
        {quote.project.raisedToMinimum && (
          <p className="text-xs text-muted">Asgari proje bedeline yükseltildi.</p>
        )}
        <p className="text-xs text-muted">
          Bakım: {formatTl(quote.project.maintenanceMinKurus)} –{' '}
          {formatTl(quote.project.maintenanceMaxKurus)} / ay
        </p>
      </div>
    );
  const col = (q: PathQuote, title: string) => (
    <div className="rounded-xl border border-border p-4 text-sm" aria-label={title}>
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-xl font-semibold text-violet tabular-nums">
        {formatTl(q.monthlyKurus)}{' '}
        <span className="text-xs font-normal text-muted">/ ay · {v}</span>
      </p>
      <ul className="mt-2 space-y-0.5 text-muted">
        <li>{q.setupFeeKurus ? `Kurulum: ${formatTl(q.setupFeeKurus)}` : 'Kurulum bedeli yok'}</li>
        <li>{q.commitmentMonths} ay taahhüt</li>
        {q.discountedMonthlyKurus !== null && (
          <li className="text-foreground">
            İlk {q.discountedMonths} ay: {formatTl(q.discountedMonthlyKurus)} / ay
          </li>
        )}
        <li>Başlangıçta: {formatTl(q.dueAtStartKurus)}</li>
        <li>Taahhüt toplamı: {formatTl(q.commitmentTotalKurus)}</li>
      </ul>
    </div>
  );
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {col(quote.noSetup, 'Kurulumsuz')}
      {col(quote.setup, 'Kurulumlu')}
    </div>
  );
}
