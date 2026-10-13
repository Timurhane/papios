import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { nextStepText } from '@/crm/labels';
import { ScoreBadge } from '@/crm/ScoreBadge';
import { usePanelApi } from '@/data/PanelApiContext';
import type { CompanySummary } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { ApprovalCard } from '@/outreach/ApprovalCard';
import { formatDateTime, REPLY_LABEL } from '@/outreach/labels';
import { OneClickList } from '@/outreach/OneClickList';

/** Bugün (K-13.2): approvals, one-click queue, calls, hot replies, analyses, waiting items, quota. */
export function TodayPage() {
  const api = usePanelApi();
  const { data, error, loading, reload } = useAsync(() => api.today(), 'today');

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Bugün</h1>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <h2 className="mb-3 font-semibold">
              Onay bekleyenler ({data.pendingApprovals.length})
            </h2>
            {data.pendingApprovals.length === 0 ? (
              <p className="text-sm text-muted">Onay bekleyen iş yok ✅</p>
            ) : (
              <ul className="space-y-2">
                {data.pendingApprovals.map((a) => (
                  <ApprovalCard key={a.id} item={a} onDone={reload} />
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Sıcak cevaplar ({data.hotReplies.length})</h2>
            {data.hotReplies.length === 0 ? (
              <p className="text-sm text-muted">Bekleyen sıcak cevap yok.</p>
            ) : (
              <ul className="space-y-2 text-sm">
                {data.hotReplies.map((m) => (
                  <li key={m.id} className="flex items-center gap-2">
                    <span className="rounded-full bg-violet/20 px-2 py-0.5 text-xs text-violet">
                      {m.classification ? REPLY_LABEL[m.classification] : 'Cevap'}
                    </span>
                    <Link to="/gelen-kutusu" className="min-w-0 flex-1 truncate hover:underline">
                      {m.company_name || m.from_address}
                    </Link>
                    <span className="text-xs text-muted">{formatDateTime(m.received_at)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Tek tık kuyruğu ({data.oneClick.length})</h2>
            <OneClickList
              items={data.oneClick}
              empty="Gönderilecek tek tık mesaj yok."
              onDone={reload}
            />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">
              Bugünün aramaları ve ziyaretleri ({data.calls.length})
            </h2>
            <OneClickList items={data.calls} empty="Bugün arama/ziyaret yok." onDone={reload} />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Son 24 saatte analiz edilenler</h2>
            <CompanyRows
              items={data.recentlyAnalyzed}
              empty="Yeni analiz yok. Telegram'a bir işletme linki gönder."
            />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Vadesi gelen beklemeler</h2>
            <CompanyRows items={data.dueWaiting} empty="Vadesi gelen kayıt yok." />
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold">Kota durumu (bugün)</h2>
            {data.quota.length === 0 ? (
              <p className="text-sm text-muted">Bugün henüz yapay zeka çağrısı yapılmadı.</p>
            ) : (
              <ul className="space-y-1 text-sm tabular-nums">
                {data.quota.map((q) => (
                  <li key={q.bucket} className="flex justify-between">
                    <span>{q.bucket}</span>
                    <span>{q.used}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </section>
  );
}

function CompanyRows({ items, empty }: { items: CompanySummary[]; empty: string }) {
  if (items.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="space-y-2">
      {items.map((c) => (
        <li key={c.id}>
          <Link
            to={`/crm/${c.id}`}
            className="flex items-center gap-3 rounded-lg p-1 hover:bg-surface-2"
          >
            <ScoreBadge score={c.score} className="h-6 min-w-9" />
            <span className="min-w-0 flex-1 truncate text-sm">{c.name}</span>
            <span className="hidden truncate text-xs text-muted sm:block">{nextStepText(c)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
