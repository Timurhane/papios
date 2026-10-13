import { formatTl } from '@papi/core';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { ProjectDetail } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { PROJECT_STATUS } from './ProjectsPage';

const PATH = { no_setup: 'Kurulumsuz', setup: 'Kurulumlu', project: 'Proje' } as const;

export function ProjectPage() {
  const { id = '' } = useParams();
  const api = usePanelApi();
  const { data, error, loading, reload } = useAsync(() => api.getProject(id), `project:${id}`);
  return (
    <section className="flex flex-col gap-5">
      <Link
        to="/projeler"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Projeler
      </Link>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {!loading && !data && !error && <p className="text-muted">Proje bulunamadı.</p>}
      {data && <ProjectView project={data} onChanged={reload} />}
    </section>
  );
}

function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function ProjectView({ project: p, onChanged }: { project: ProjectDetail; onChanged: () => void }) {
  const api = usePanelApi();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const copy = async (label: string, text: string) => {
    await navigator.clipboard?.writeText(text);
    setCopied(label);
  };

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-4 sm:p-6">
        <h1 className="text-xl font-semibold">{p.name}</h1>
        <Link to={`/crm/${p.company_id}`} className="text-sm hover:underline">
          {p.company_name}
        </Link>
        <p className="text-sm text-muted">
          {PATH[p.payment_path]}
          {p.monthly_kurus ? ` · ${formatTl(p.monthly_kurus)}/ay` : ''}
          {p.setup_fee_kurus ? ` · kurulum ${formatTl(p.setup_fee_kurus)}` : ''}
          {p.project_kurus ? ` · proje ${formatTl(p.project_kurus)}` : ''}
          {` · başlangıç ${p.started_on}`}
          {p.contract_end ? ` · sözleşme sonu ${p.contract_end}` : ''}
        </p>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label className="flex items-center gap-2">
            Durum
            <select
              aria-label="Proje durumu"
              className="h-9 rounded-lg border border-border bg-surface-2 px-2"
              value={p.status}
              onChange={(e) =>
                run(() =>
                  api.updateProject(p.id, { status: e.target.value as ProjectDetail['status'] }),
                )
              }
            >
              {Object.entries(PROJECT_STATUS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <span className="ml-2 text-muted">Memnuniyet:</span>
          <Button
            size="sm"
            variant={p.satisfaction === 'positive' ? 'primary' : 'outline'}
            onClick={() => run(() => api.updateProject(p.id, { satisfaction: 'positive' }))}
          >
            Memnun
          </Button>
          <Button
            size="sm"
            variant={p.satisfaction === 'negative' ? 'primary' : 'outline'}
            onClick={() => run(() => api.updateProject(p.id, { satisfaction: 'negative' }))}
          >
            Memnun değil
          </Button>
        </div>
        <p className="text-xs text-muted">
          Memnun işaretlenirse Referans dizisi referans isteğini hazırlar.
        </p>
      </Card>
      <ErrorText>{error}</ErrorText>

      <Card className="flex flex-col gap-2 p-4 sm:p-6">
        <h2 className="font-semibold">Kurulum formu</h2>
        {!p.form ? (
          <p className="text-sm text-muted">Form yok.</p>
        ) : p.form.status === 'sent' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span>Müşterinin doldurması bekleniyor.</span>
            {p.form.url && (
              <Button size="sm" variant="outline" onClick={() => copy('form', p.form?.url ?? '')}>
                {copied === 'form' ? 'Kopyalandı' : 'Form linkini kopyala'}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm">Form dolduruldu ✅</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4 sm:p-6">
        <h2 className="font-semibold">Claude Code kurulum promptu</h2>
        {p.artifacts.claude_prompt ? (
          <>
            <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-surface-2 p-3 font-mono text-xs">
              {p.artifacts.claude_prompt}
            </pre>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" onClick={() => copy('prompt', p.artifacts.claude_prompt ?? '')}>
                {copied === 'prompt' ? 'Kopyalandı' : 'Promptu kopyala'}
              </Button>
              {p.artifacts.config && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    download('papi-config.json', p.artifacts.config ?? '', 'application/json')
                  }
                >
                  papi-config.json indir
                </Button>
              )}
            </div>
            {!p.artifacts.config && (
              <p className="text-xs text-muted">
                Yapılandırma dosyası kurulum formu gelince oluşur.
              </p>
            )}
          </>
        ) : (
          <p className="text-sm text-muted">Henüz yok.</p>
        )}
      </Card>

      <Card className="flex flex-col gap-2 p-4 sm:p-6">
        <h2 className="font-semibold">
          Kontrol listesi ({p.tasks.filter((t) => t.done).length}/{p.tasks.length})
        </h2>
        <ul className="space-y-1 text-sm" aria-label="Kontrol listesi">
          {p.tasks.map((t) => (
            <li key={t.id}>
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={t.done}
                  onChange={(e) => run(() => api.setTaskDone(t.id, e.target.checked))}
                />
                <span className={t.done ? 'text-muted line-through' : ''}>{t.title}</span>
              </label>
            </li>
          ))}
        </ul>
      </Card>

      {p.payments.length > 0 && (
        <Card className="flex flex-col gap-2 p-4 sm:p-6">
          <h2 className="font-semibold">Ödemeler</h2>
          <ul className="space-y-1 text-sm tabular-nums">
            {p.payments.map((x) => (
              <li key={x.id} className="flex justify-between gap-2">
                <span>
                  {x.due_on} · {formatTl(x.amount_kurus)}
                </span>
                <span className="text-muted">
                  {x.status === 'paid'
                    ? `ödendi ${x.paid_on}`
                    : x.status === 'due'
                      ? 'bekliyor'
                      : 'iptal'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
