import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { PlaybookOverview } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { CHANNEL_LABEL } from './labels';

const pct = (part: number, whole: number) =>
  whole > 0 ? `%${Math.round((part / whole) * 100)}` : '—';

/** Playbook'lar (K-11): steps with per-step performance. Editing steps comes with Ayarlar. */
export function PlaybooksPage() {
  const api = usePanelApi();
  const { data, error, loading } = useAsync(() => api.listPlaybooks(), 'playbooks');
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Playbook&apos;lar</h1>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data?.map((p) => (
        <PlaybookCard key={p.id} playbook={p} />
      ))}
    </section>
  );
}

function PlaybookCard({ playbook: p }: { playbook: PlaybookOverview }) {
  const sent = p.steps.reduce((n, s) => n + s.sent, 0);
  const replies = p.steps.reduce((n, s) => n + s.replies, 0);
  return (
    <Card className="p-4 sm:p-6">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-lg font-semibold">{p.name}</h2>
        {!p.active && <span className="text-xs text-muted">(kapalı)</span>}
        <span className="ml-auto text-xs text-muted">
          {p.activeEnrollments} aktif firma · {sent} temas · cevap oranı {pct(replies, sent)}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{p.description}</p>
      <p className="mt-1 text-xs text-muted">Tetikleyici: {p.trigger}</p>
      {p.steps.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[34rem] text-left text-sm">
            <caption className="sr-only">{p.name} adımları</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pr-2 font-normal">Adım</th>
                <th className="py-1 pr-2 font-normal">Gün</th>
                <th className="py-1 pr-2 font-normal">Kanal</th>
                <th className="py-1 pr-2 font-normal">Açı</th>
                <th className="py-1 pr-2 text-right font-normal">Giden</th>
                <th className="py-1 pr-2 text-right font-normal">Bekleyen</th>
                <th className="py-1 pr-2 text-right font-normal">Cevap</th>
                <th className="py-1 text-right font-normal">Olumlu</th>
              </tr>
            </thead>
            <tbody className="tabular-nums">
              {p.steps.map((s) => (
                <tr key={s.position} className="border-t border-border">
                  <td className="py-1.5 pr-2">{s.position}</td>
                  <td className="py-1.5 pr-2">{s.day_offset}</td>
                  <td className="py-1.5 pr-2">{CHANNEL_LABEL[s.channel]}</td>
                  <td className="py-1.5 pr-2">{s.angle}</td>
                  <td className="py-1.5 pr-2 text-right">{s.sent}</td>
                  <td className="py-1.5 pr-2 text-right">{s.pending}</td>
                  <td className="py-1.5 pr-2 text-right">
                    {s.replies} <span className="text-xs text-muted">{pct(s.replies, s.sent)}</span>
                  </td>
                  <td className="py-1.5 text-right">{s.positive}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
