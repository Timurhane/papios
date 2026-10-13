import { formatTl, funnel } from '@papi/core';
import { useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { PLAYBOOK_LABEL, formatDate } from '@/crm/labels';
import { usePanelApi } from '@/data/PanelApiContext';
import type { Channel, MetricsFilter } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { CHANNEL_LABEL, formatDateTime } from '@/outreach/labels';

const PERIODS = [7, 30, 90] as const;
const selectClass = 'h-10 rounded-xl border border-border bg-surface-2 px-3 text-sm';

/** Ölçütler (K-16): revenue, funnel (playbook / channel), clients and system health. */
export function MetricsPage() {
  const api = usePanelApi();
  const [f, setF] = useState<MetricsFilter>({ days: 30, playbook: 'all', channel: 'all' });
  const { data, error, loading } = useAsync(
    () => api.metrics(f),
    `metrics:${f.days}:${f.playbook}:${f.channel}`,
  );
  const steps = data ? funnel(data.funnel) : [];
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Ölçütler</h1>
      <ErrorText>{error}</ErrorText>
      {loading && !data && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <Stat
              label="Aylık yinelenen gelir"
              value={formatTl(data.mrrKurus)}
              note={
                data.targetKurus
                  ? `Hedefe kalan: ${formatTl(Math.max(0, data.targetKurus - data.mrrKurus))}`
                  : 'Hedef ayarlanmadı'
              }
            />
            <Stat label="Hattaki teklifler" value={formatTl(data.pipelineKurus)} />
            <Stat
              label="İlk cevap süresi (medyan)"
              value={data.firstReplyHours === null ? '—' : `${data.firstReplyHours} saat`}
            />
            <Stat
              label="Aktif müşteri"
              value={String(data.clients.active)}
              note={`Müşteri başı ${formatTl(data.clients.avgMonthlyKurus)}/ay · iptal ${data.clients.cancelled}`}
            />
          </div>

          <Card className="flex flex-col gap-3 p-4 sm:p-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-semibold">Huni</h2>
              <div className="flex flex-wrap gap-2">
                <select
                  aria-label="Dönem"
                  className={selectClass}
                  value={f.days}
                  onChange={(e) => setF({ ...f, days: Number(e.target.value) })}
                >
                  {PERIODS.map((d) => (
                    <option key={d} value={d}>
                      Son {d} gün
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Playbook"
                  className={selectClass}
                  value={f.playbook}
                  onChange={(e) => setF({ ...f, playbook: e.target.value })}
                >
                  <option value="all">Tüm playbook'lar</option>
                  {data.playbooks.map((p) => (
                    <option key={p} value={p}>
                      {PLAYBOOK_LABEL[p] ?? p}
                    </option>
                  ))}
                </select>
                <select
                  aria-label="Kanal"
                  className={selectClass}
                  value={f.channel}
                  onChange={(e) => setF({ ...f, channel: e.target.value as Channel | 'all' })}
                >
                  <option value="all">Tüm kanallar</option>
                  {(Object.keys(CHANNEL_LABEL) as Channel[]).map((c) => (
                    <option key={c} value={c}>
                      {CHANNEL_LABEL[c]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <ol className="flex flex-col gap-2" aria-label="Huni">
              {steps.map((s) => (
                <li key={s.key} className="grid grid-cols-[8rem_1fr_6rem] items-center gap-2">
                  <span className="text-sm">{s.label}</span>
                  <span className="h-3 rounded-full bg-surface-2">
                    <span
                      className="block h-3 rounded-full bg-gradient-to-r from-violet to-blue"
                      style={{ width: `${(s.count / max) * 100}%` }}
                    />
                  </span>
                  <span className="text-right text-sm tabular-nums">
                    {s.count}
                    {s.rate !== null && (
                      <span className="text-xs text-muted"> · %{Math.round(s.rate * 100)}</span>
                    )}
                  </span>
                </li>
              ))}
            </ol>
            {f.channel !== 'all' && (
              <p className="text-xs text-muted">
                Kanal filtresi temas ve cevaplara uygulanır; görüşme, teklif ve kazanım kanaldan
                bağımsızdır.
              </p>
            )}
          </Card>

          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-4 sm:p-6">
              <h2 className="mb-2 font-semibold">Yaklaşan yenilemeler (45 gün)</h2>
              {data.clients.renewals.length === 0 ? (
                <p className="text-sm text-muted">Yaklaşan yenileme yok.</p>
              ) : (
                <ul className="space-y-1 text-sm" aria-label="Yaklaşan yenilemeler">
                  {data.clients.renewals.map((r) => (
                    <li key={`${r.company_name}${r.contract_end}`}>
                      {r.company_name} — {formatDate(r.contract_end)}
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card className="p-4 sm:p-6">
              <h2 className="mb-2 font-semibold">Sistem sağlığı</h2>
              <ul className="space-y-1 text-sm" aria-label="Sistem sağlığı">
                {data.health.quota.map((q) => (
                  <li key={q.bucket}>
                    Kota {q.bucket}: {q.used}/{q.rpd ?? '—'} bugün
                  </li>
                ))}
                <li>
                  Kuyruk: {data.health.queued} bekleyen · {data.health.dead} başarısız
                </li>
                <li>Hata (24 saat): {data.health.errors24h}</li>
                <li>
                  En uzun bekleyen onay:{' '}
                  {data.health.oldestApprovalAt
                    ? formatDateTime(data.health.oldestApprovalAt)
                    : 'yok'}
                </li>
                <li className="text-xs text-muted">
                  GitHub Actions dakikaları: depo → Settings → Billing (aylık ücretsiz kota).
                </li>
              </ul>
            </Card>
          </div>

          <Card className="p-4 sm:p-6">
            <h2 className="mb-3 font-semibold">Ücretsiz limitler</h2>
            <ul className="flex flex-col gap-3" aria-label="Ücretsiz limitler">
              {data.usage.map((u) => {
                const pct = Math.min(100, Math.round((u.used / u.limit) * 100));
                return (
                  <li key={u.label} className="text-sm">
                    <div className="flex flex-wrap justify-between gap-2">
                      <span>{u.label}</span>
                      <span className="tabular-nums">
                        {u.used.toLocaleString('tr-TR')} / {u.limit.toLocaleString('tr-TR')}{' '}
                        {u.unit} · %{pct}
                      </span>
                    </div>
                    <span className="mt-1 block h-2 rounded-full bg-surface-2">
                      <span
                        className={`block h-2 rounded-full ${pct >= 80 ? 'bg-red-500' : 'bg-gradient-to-r from-violet to-blue'}`}
                        style={{ width: `${pct}%` }}
                      />
                    </span>
                    {pct >= 80 && <span className="text-xs text-red-500">Limite yaklaşıldı.</span>}
                    {u.note && <span className="block text-xs text-muted">{u.note}</span>}
                  </li>
                );
              })}
            </ul>
          </Card>
        </>
      )}
    </section>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {note && <p className="text-xs text-muted">{note}</p>}
    </Card>
  );
}
