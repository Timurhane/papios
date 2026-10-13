import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { usePanelApi } from '@/data/PanelApiContext';
import type { OneClickItem } from '@/data/types';
import { CHANNEL_LABEL, doneLabel, openLink } from './labels';

/** K-10.16: open the prepared message, send it yourself, then press "Gönderdim" (or skip). */
export function OneClickList({
  items,
  empty,
  onDone,
}: {
  items: OneClickItem[];
  empty: string;
  onDone: () => void;
}) {
  const api = usePanelApi();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function complete(id: string, action: 'sent' | 'skip') {
    setBusy(id);
    setError(null);
    try {
      if (!(await api.completeTouch(id, action)))
        setError('Bu iş artık beklemiyor ya da alıcı reddedenler listesinde.');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <>
      <ErrorText>{error}</ErrorText>
      <ul className="space-y-3">
        {items.map((t) => {
          const link = openLink(t);
          return (
            <li key={t.id} className="rounded-xl border border-border p-3 text-sm">
              <div className="flex justify-between gap-3">
                <Link to={`/crm/${t.company_id}`} className="font-medium hover:underline">
                  {t.company_name || 'Firma'}
                </Link>
                <span className="text-xs text-muted">{CHANNEL_LABEL[t.channel]}</span>
              </div>
              {t.body && <p className="mt-2 whitespace-pre-wrap text-muted">{t.body}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                {link && (
                  <a
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm hover:bg-surface-2"
                  >
                    {link.label}
                  </a>
                )}
                <Button size="sm" disabled={busy === t.id} onClick={() => complete(t.id, 'sent')}>
                  {doneLabel(t.channel)}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy === t.id}
                  onClick={() => complete(t.id, 'skip')}
                >
                  Atla
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}
