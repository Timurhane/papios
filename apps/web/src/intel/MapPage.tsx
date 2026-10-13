import { planRoute } from '@papi/core';
import { lazy, Suspense, useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { STAGE_LABEL } from '@/crm/labels';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';
import { LEGEND, markerColor } from './map-colors';

// Leaflet is loaded only on this page.
const LeafletMap = lazy(() => import('./LeafletMap').then((m) => ({ default: m.LeafletMap })));

/** Harita (K-3.11, K-10.7): leads by score and stage; pick the day's visits for a route. */
export function MapPage() {
  const api = usePanelApi();
  const { data, error } = useAsync(() => api.mapCompanies(), 'map');
  const [minScore, setMinScore] = useState(0);
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = useCallback(
    (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])),
    [],
  );
  const shown = useMemo(
    () => data?.companies.filter((c) => (c.score ?? 0) >= minScore || picked.includes(c.id)) ?? [],
    [data, minScore, picked],
  );
  const route = useMemo(
    () =>
      data
        ? planRoute(
            data.home,
            data.companies.filter((c) => picked.includes(c.id)),
          )
        : { order: [], km: 0 },
    [data, picked],
  );
  const routeIds = useMemo(() => route.order.map((c) => c.id), [route]);

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Harita</h1>
      <ErrorText>{error}</ErrorText>
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-xs">
            <label className="flex items-center gap-2">
              En düşük puan
              <Input
                type="number"
                min={0}
                max={100}
                aria-label="En düşük puan"
                className="h-9 w-20"
                value={minScore}
                onChange={(e) => setMinScore(Number(e.target.value) || 0)}
              />
            </label>
            {LEGEND.map((l) => (
              <span key={l.label} className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-full" style={{ background: l.color }} />
                {l.label}
              </span>
            ))}
          </div>
          <Card className="p-2">
            <Suspense fallback={<p className="p-4 text-sm text-muted">Harita yükleniyor…</p>}>
              <LeafletMap companies={shown} home={data.home} route={routeIds} onToggle={toggle} />
            </Suspense>
          </Card>
          <div className="grid gap-3 md:grid-cols-2">
            <Card className="p-4">
              <h2 className="mb-2 font-semibold">Adaylar ({shown.length})</h2>
              <ul
                className="max-h-80 space-y-1 overflow-auto text-sm"
                aria-label="Haritadaki adaylar"
              >
                {shown.map((c) => (
                  <li key={c.id} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      aria-label={`${c.name} rotaya ekle`}
                      checked={picked.includes(c.id)}
                      onChange={() => toggle(c.id)}
                    />
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ background: markerColor(c) }}
                    />
                    <Link to={`/crm/${c.id}`} className="hover:underline">
                      {c.name}
                    </Link>
                    <span className="text-xs text-muted">
                      {c.score ?? '—'} · {STAGE_LABEL[c.stage]}
                    </span>
                  </li>
                ))}
              </ul>
              {data.companies.length === 0 && (
                <p className="text-sm text-muted">
                  Konumu bilinen aday yok. Adresi olan firmaların konumu haftalık bulunur.
                </p>
              )}
            </Card>
            <Card className="flex flex-col gap-2 p-4">
              <h2 className="font-semibold">Ziyaret rotası</h2>
              {route.order.length === 0 ? (
                <p className="text-sm text-muted">Haritadan veya listeden firma seç.</p>
              ) : (
                <>
                  <ol className="list-decimal space-y-1 pl-5 text-sm" aria-label="Ziyaret rotası">
                    {route.order.map((c) => (
                      <li key={c.id}>
                        {c.name}
                        {c.address ? (
                          <span className="text-xs text-muted"> — {c.address}</span>
                        ) : null}
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-muted">
                    Yaklaşık {route.km} km (kuş uçuşu, en yakın komşu sırası).
                  </p>
                  <div className="flex gap-2">
                    <Link
                      to={`/harita/yazdir?ids=${routeIds.join(',')}`}
                      className="inline-flex h-9 items-center rounded-xl border border-border px-3 text-sm"
                    >
                      Yazdırılabilir analizler
                    </Link>
                    <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                      Temizle
                    </Button>
                  </div>
                </>
              )}
            </Card>
          </div>
          <p className="text-xs text-muted">
            Harita verisi © OpenStreetMap katkıcıları; konumlar Nominatim ile bulunur.
          </p>
        </>
      )}
    </section>
  );
}
