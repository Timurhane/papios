import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';

export const PROJECT_STATUS = {
  setup: 'Kurulumda',
  active: 'Aktif',
  paused: 'Durdu',
  ended: 'Bitti',
} as const;

/** Projeler (K-13.2): won clients' setup and delivery. */
export function ProjectsPage() {
  const api = usePanelApi();
  const { data, error, loading } = useAsync(() => api.listProjects(), 'projects');
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Projeler</h1>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data?.length === 0 && (
        <p className="text-sm text-muted">
          Henüz proje yok. Bir teklif "Kabul edildi" işaretlenince proje kendiliğinden açılır.
        </p>
      )}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-2" aria-label="Projeler">
          {data.map((p) => (
            <li key={p.id}>
              <Link to={`/projeler/${p.id}`}>
                <Card className="flex flex-wrap items-center gap-3 p-4 hover:bg-surface-2">
                  <span className="min-w-0 flex-1 truncate font-medium">{p.name}</span>
                  <span className="text-sm text-muted tabular-nums">
                    Kontrol listesi {p.tasks_done}/{p.tasks_total}
                  </span>
                  <span
                    className={cn(
                      'rounded-full px-2 py-0.5 text-xs',
                      p.status === 'active'
                        ? 'bg-violet/20 text-violet'
                        : 'bg-surface-2 text-muted',
                    )}
                  >
                    {PROJECT_STATUS[p.status]}
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
