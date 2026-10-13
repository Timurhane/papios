import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { DemoSummary } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { formatDateTime } from '@/outreach/labels';
import { cn } from '@/lib/utils';

/** Kişiye özel demo (K-13.7): 14-day demo pages, their use and links. */
export function DemosPage() {
  const api = usePanelApi();
  const { data, error, loading } = useAsync(() => api.listDemos(), 'demos');
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Kişiye özel demo</h1>
      <p className="text-sm text-muted">
        Demo oluşturmak için firma kartında "Demo oluştur"a bas ya da Telegram'da /demo {'{firma}'}{' '}
        yaz. Demolar 14 gün sonra kendiliğinden kapanır.
      </p>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data?.length === 0 && <p className="text-sm text-muted">Henüz demo yok.</p>}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Demolar">
          {data.map((d) => (
            <DemoRow key={d.id} demo={d} />
          ))}
        </ul>
      )}
    </section>
  );
}

export function DemoRow({ demo: d }: { demo: DemoSummary }) {
  const [copied, setCopied] = useState(false);
  const [now] = useState(() => Date.now());
  const open = d.status === 'active' && new Date(d.expires_at).getTime() > now;
  return (
    <li>
      <Card className="flex flex-wrap items-center gap-3 p-4 text-sm">
        <Link
          to={`/crm/${d.company_id}`}
          className="min-w-0 flex-1 truncate font-medium hover:underline"
        >
          {d.company_name}
        </Link>
        <span className="text-muted tabular-nums">
          {d.visits} ziyaret · {d.messages} mesaj
        </span>
        <span
          className={cn(
            'rounded-full px-2 py-0.5 text-xs',
            open ? 'bg-violet/20 text-violet' : 'bg-surface-2 text-muted',
          )}
        >
          {open ? `${formatDateTime(d.expires_at)} tarihine kadar açık` : 'Kapandı'}
        </span>
        {open && d.url && (
          <button
            type="button"
            className="rounded-lg border border-border px-2 py-1 text-xs hover:bg-surface-2"
            onClick={async () => {
              await navigator.clipboard?.writeText(d.url ?? '');
              setCopied(true);
            }}
          >
            {copied ? 'Kopyalandı' : 'Linki kopyala'}
          </button>
        )}
      </Card>
    </li>
  );
}
