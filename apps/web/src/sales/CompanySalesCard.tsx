import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';
import { formatDateTime } from '@/outreach/labels';
import { PROPOSAL_STATUS } from '@/proposals/labels';
import { DemoRow } from './DemosPage';

const MEETING_STATUS = {
  proposed: 'Saat önerildi',
  scheduled: 'Planlandı',
  done: 'Yapıldı',
  cancelled: 'İptal',
  no_show: 'Gelmedi',
} as const;

/** Firma kartında satış: hazırlık, görüşme saatleri, görüşme notu, teklifler, demo (Satıcı). */
export function CompanySalesCard({ companyId }: { companyId: string }) {
  const api = usePanelApi();
  const sales = useAsync(() => api.companySales(companyId), `sales:${companyId}`);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [brief, setBrief] = useState<string | null>(null);
  const [slots, setSlots] = useState<{
    meetingId: string;
    slots: { start: string; label: string }[];
  } | null>(null);
  const [note, setNote] = useState('');
  const worker = api.workerAvailable();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      sales.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-4 p-4 sm:p-6">
      <h2 className="font-semibold">Satış</h2>
      {!worker && (
        <p className="text-sm text-amber-500">
          Sunucu bağlantısı (VITE_API_URL) kurulunca hazırlık notu, görüşme saatleri, not ve demo
          buradan çalışır.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !worker}
          onClick={() =>
            run(async () =>
              setBrief((await api.worker<{ text: string }>('meeting.brief', { companyId })).text),
            )
          }
        >
          Hazırlık notu
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !worker}
          onClick={() =>
            run(async () =>
              setSlots(
                await api.worker<{ meetingId: string; slots: { start: string; label: string }[] }>(
                  'meeting.propose',
                  { companyId },
                ),
              ),
            )
          }
        >
          Görüşme saatleri öner
        </Button>
        <Link
          to={`/teklifler/yeni?firma=${companyId}`}
          className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm hover:bg-surface-2"
        >
          Teklif hazırla
        </Link>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || !worker}
          onClick={() => run(async () => void (await api.worker('demo.create', { companyId })))}
        >
          Demo oluştur
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
      {brief && (
        <pre className="whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-sans text-sm">
          {brief}
        </pre>
      )}
      {slots && (
        <div className="text-sm">
          <p className="mb-2 text-muted">Firma hangisini seçerse onu işaretle:</p>
          <ul className="space-y-1">
            {slots.slots.map((s) => (
              <li key={s.start} className="flex items-center justify-between gap-2">
                <span>{s.label}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api.worker('meeting.schedule', {
                        meetingId: slots.meetingId,
                        start: s.start,
                      });
                      setSlots(null);
                    })
                  }
                >
                  Bunu seçti
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium" htmlFor={`note-${companyId}`}>
          Görüşme notu
        </label>
        <textarea
          id={`note-${companyId}`}
          className="min-h-24 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          placeholder="İhtiyaçlar, bütçe, itirazlar, sonraki adım… (kişisel bilgiler modele gitmeden ayıklanır)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button
          size="sm"
          disabled={busy || !worker || note.trim().length < 3}
          onClick={() =>
            run(async () => {
              await api.worker('meeting.note', { companyId, text: note });
              setNote('');
            })
          }
        >
          Notu kaydet ve teklif taslağı çıkar
        </Button>
      </div>
      {sales.data && (
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <h3 className="mb-1 font-medium">Görüşmeler</h3>
            {sales.data.meetings.length === 0 ? (
              <p className="text-muted">Yok</p>
            ) : (
              <ul className="space-y-1">
                {sales.data.meetings.map((m) => (
                  <li key={m.id}>
                    {MEETING_STATUS[m.status]}
                    {m.starts_at ? ` · ${formatDateTime(m.starts_at)}` : ''}
                    {m.summary && <span className="block text-xs text-muted">{m.summary}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="mb-1 font-medium">Teklifler</h3>
            {sales.data.proposals.length === 0 ? (
              <p className="text-muted">Yok</p>
            ) : (
              <ul className="space-y-1">
                {sales.data.proposals.map((p) => (
                  <li key={p.id}>
                    <Link to={`/teklifler/${p.id}`} className="hover:underline">
                      {p.number}
                    </Link>{' '}
                    · {PROPOSAL_STATUS[p.status]}
                  </li>
                ))}
              </ul>
            )}
          </div>
          {sales.data.demos.length > 0 && (
            <ul className="sm:col-span-2">
              {sales.data.demos.slice(0, 1).map((d) => (
                <DemoRow key={d.id} demo={d} />
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
