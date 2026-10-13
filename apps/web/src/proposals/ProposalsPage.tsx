import { formatTl } from '@papi/core';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { formatDate } from '@/crm/labels';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';
import { PROPOSAL_STATUS, STATUS_TONE } from './labels';

/** Teklif stüdyosu (K-13.6): all proposals. */
export function ProposalsPage() {
  const api = usePanelApi();
  const { data, error, loading } = useAsync(() => api.listProposals(), 'proposals');
  return (
    <section className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Teklif stüdyosu</h1>
        <Link
          to="/teklifler/yeni"
          className="inline-flex h-9 items-center rounded-xl bg-gradient-to-r from-violet to-blue px-3 text-sm font-medium text-white"
        >
          Yeni teklif
        </Link>
      </div>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data?.length === 0 && (
        <p className="text-sm text-muted">
          Henüz teklif yok. Telegram'da /gorusme ile not al ya da buradan yeni teklif hazırla.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Teklifler">
          {data.map((p) => (
            <li key={p.id}>
              <Link to={`/teklifler/${p.id}`}>
                <Card className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2">
                  <span className="font-medium">{p.number}</span>
                  <span className="min-w-0 flex-1 truncate">{p.company_name}</span>
                  <span className="text-sm text-muted">
                    {p.package_code}
                    {p.monthly_kurus ? ` · ${formatTl(p.monthly_kurus)}/ay` : ''}
                  </span>
                  <span className="text-xs text-muted">{formatDate(p.created_at)}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[p.status])}>
                    {PROPOSAL_STATUS[p.status]}
                  </span>
                </Card>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
