import { useSearchParams } from 'react-router';
import { Button } from '@/components/ui/button';
import { STAGE_LABEL } from '@/crm/labels';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';

/** K-10.7: one printable page per company for a visit day (analysis summary, no personal data). */
export function PrintPage() {
  const api = usePanelApi();
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean).slice(0, 20);
  const { data, error } = useAsync(
    async () => (await Promise.all(ids.map((id) => api.getCompany(id)))).filter((c) => c !== null),
    `print:${ids.join(',')}`,
  );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <h1 className="text-2xl font-semibold tracking-tight">Ziyaret analizleri</h1>
        <Button size="sm" onClick={() => window.print()}>
          Yazdır
        </Button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {data?.map((c, i) => (
        <article
          key={c.id}
          className="rounded-2xl border border-border bg-white p-6 text-black print:break-after-page print:rounded-none print:border-0"
        >
          <p className="text-xs text-gray-500">{i + 1}. durak · AJNA Digital · Papi analizi</p>
          <h2 className="text-xl font-semibold">{c.name}</h2>
          <p className="text-sm">{[c.sector, c.city, c.address].filter(Boolean).join(' · ')}</p>
          <p className="mt-1 text-sm">
            Puan: <strong>{c.score ?? '—'}</strong>/100 · {STAGE_LABEL[c.stage]}
            {c.website_url ? ` · ${c.website_url}` : ''}
          </p>
          {c.analysis?.strongest_finding && (
            <p className="mt-4 rounded-lg bg-gray-100 p-3 text-sm">
              <strong>En güçlü bulgu:</strong> {c.analysis.strongest_finding}
            </p>
          )}
          {c.analysis?.findings.length ? (
            <>
              <h3 className="mt-4 font-semibold">Bulgular</h3>
              <ul className="list-disc pl-5 text-sm">
                {c.analysis.findings.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </>
          ) : null}
          {c.analysis?.pagespeed?.mobile?.performance != null && (
            <p className="mt-2 text-sm">Mobil hız: {c.analysis.pagespeed.mobile.performance}/100</p>
          )}
          {c.score_rationale.length > 0 && (
            <>
              <h3 className="mt-4 font-semibold">Puanın gerekçesi</h3>
              <ul className="list-disc pl-5 text-sm">
                {c.score_rationale.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </>
          )}
          <h3 className="mt-4 font-semibold">Görüşme notu</h3>
          <div className="mt-1 h-32 rounded-lg border border-dashed border-gray-400" />
        </article>
      ))}
    </section>
  );
}
