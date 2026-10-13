import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { InboxItem, ReplyClass } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';
import { CHANNEL_LABEL, formatDateTime, REPLY_LABEL } from './labels';

const FILTERS: (ReplyClass | 'all')[] = [
  'all',
  'interested',
  'question',
  'later',
  'no',
  'do_not_contact',
  'auto_reply',
  'unknown',
];

const HOT = new Set<ReplyClass>(['interested', 'question']);

/** Gelen kutusu (K-13.2): classified replies; a reply already stopped its sequence (K-10.12). */
export function InboxPage() {
  const api = usePanelApi();
  const [filter, setFilter] = useState<ReplyClass | 'all'>('all');
  const [openOnly, setOpenOnly] = useState(true);
  const { data, error, loading, reload } = useAsync(
    () => api.listInbox({ classification: filter, openOnly }),
    `inbox:${filter}:${openOnly}`,
  );

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Gelen kutusu</h1>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Sınıf">
        {FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={cn(
              'rounded-full border border-border px-3 py-1 text-xs',
              filter === f ? 'bg-violet text-white' : 'text-muted hover:bg-surface-2',
            )}
          >
            {f === 'all' ? 'Tümü' : REPLY_LABEL[f]}
          </button>
        ))}
        <label className="ml-auto flex items-center gap-2 text-xs text-muted">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Yalnızca işlenmemiş
        </label>
      </div>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data && data.length === 0 && (
        <p className="text-sm text-muted">
          Gelen cevap yok. Mail bağlantısı kurulunca cevaplar burada sınıflanmış görünür.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-3" aria-label="Cevaplar">
          {data.map((m) => (
            <InboxRow key={m.id} item={m} onChanged={reload} />
          ))}
        </ul>
      )}
    </section>
  );
}

function InboxRow({ item: m, onChanged }: { item: InboxItem; onChanged: () => void }) {
  const api = usePanelApi();
  const [busy, setBusy] = useState(false);
  const toggle = async () => {
    setBusy(true);
    try {
      await api.setInboxHandled(m.id, !m.handled);
      onChanged();
    } finally {
      setBusy(false);
    }
  };
  return (
    <li>
      <Card className={cn('p-4', m.handled && 'opacity-60')}>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {m.classification && (
            <span
              className={cn(
                'rounded-full px-2 py-0.5 text-xs',
                HOT.has(m.classification)
                  ? 'bg-violet/20 text-violet'
                  : m.classification === 'do_not_contact'
                    ? 'bg-danger/15 text-danger'
                    : 'bg-surface-2 text-muted',
              )}
            >
              {REPLY_LABEL[m.classification]}
            </span>
          )}
          {m.company_id ? (
            <Link to={`/crm/${m.company_id}`} className="font-medium hover:underline">
              {m.company_name || 'Firma'}
            </Link>
          ) : (
            <span className="font-medium">{m.from_address ?? 'Bilinmeyen gönderen'}</span>
          )}
          <span className="ml-auto text-xs text-muted">
            {CHANNEL_LABEL[m.channel]} · {formatDateTime(m.received_at)}
          </span>
        </div>
        {m.subject && <p className="mt-2 text-sm font-medium">{m.subject}</p>}
        {m.body && (
          <p className="mt-1 line-clamp-6 whitespace-pre-wrap text-sm text-muted">{m.body}</p>
        )}
        <div className="mt-3">
          <Button size="sm" variant="outline" disabled={busy} onClick={toggle}>
            {m.handled ? 'İşlenmedi olarak işaretle' : 'İşlendi'}
          </Button>
        </div>
      </Card>
    </li>
  );
}
