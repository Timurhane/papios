import { LayoutGrid, List, Search } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import type { CompanySummary, Stage } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';
import { CsvImport } from './CsvImport';
import { KANBAN_COLUMNS, nextStepText, STAGE_LABEL } from './labels';
import { ScoreBadge } from './ScoreBadge';

type View = 'list' | 'kanban';

export function CrmPage() {
  const api = usePanelApi();
  const [view, setView] = useState<View>('list');
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState<Stage | 'all'>('all');
  const [showImport, setShowImport] = useState(false);
  const { data, error, loading, reload } = useAsync(
    () => api.listCompanies({ search, stage }),
    `crm:${search}:${stage}`,
  );

  return (
    <section className="flex flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">CRM</h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setShowImport((v) => !v)}>
            CSV yükle
          </Button>
          <div
            className="flex rounded-xl border border-border p-0.5"
            role="group"
            aria-label="Görünüm"
          >
            <Button
              variant={view === 'list' ? 'outline' : 'ghost'}
              size="sm"
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
            >
              <List className="h-4 w-4" aria-hidden /> Liste
            </Button>
            <Button
              variant={view === 'kanban' ? 'outline' : 'ghost'}
              size="sm"
              aria-pressed={view === 'kanban'}
              onClick={() => setView('kanban')}
            >
              <LayoutGrid className="h-4 w-4" aria-hidden /> Kanban
            </Button>
          </div>
        </div>
      </header>

      {showImport && <CsvImport onDone={reload} />}

      <div className="flex flex-col gap-2 sm:flex-row">
        <label className="relative flex-1">
          <span className="sr-only">Ara</span>
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <Input
            className="pl-9"
            placeholder="Firma, şehir veya sektör ara"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Aşama"
          className="h-11 rounded-xl border border-border bg-surface-2 px-3 text-sm"
          value={stage}
          onChange={(e) => setStage(e.target.value as Stage | 'all')}
        >
          <option value="all">Tüm aşamalar</option>
          {(Object.keys(STAGE_LABEL) as Stage[]).map((s) => (
            <option key={s} value={s}>
              {STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </div>

      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data && data.length === 0 && (
        <Card>
          <p className="text-sm text-muted">
            Henüz firma yok. Telegram'dan bir işletme linki gönder veya CSV yükle.
          </p>
        </Card>
      )}
      {data &&
        data.length > 0 &&
        (view === 'list' ? <CompanyList companies={data} /> : <Kanban companies={data} />)}
    </section>
  );
}

function CompanyList({ companies }: { companies: CompanySummary[] }) {
  return (
    <ul className="flex flex-col gap-2" aria-label="Firmalar">
      {companies.map((c) => (
        <li key={c.id}>
          <Link
            to={`/crm/${c.id}`}
            className="flex items-center gap-3 rounded-xl border border-border bg-surface/70 p-3 transition-colors hover:border-violet/40 hover:bg-surface-2"
          >
            <ScoreBadge score={c.score} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{c.name}</p>
              <p className="truncate text-xs text-muted">
                {[c.sector, c.city].filter(Boolean).join(' · ') || '—'}
              </p>
              <p className="truncate text-xs text-violet/90 sm:hidden">{nextStepText(c)}</p>
            </div>
            <div className="hidden text-right text-xs sm:block">
              <p>{STAGE_LABEL[c.stage]}</p>
              <p className="text-muted">{nextStepText(c)}</p>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Kanban({ companies }: { companies: CompanySummary[] }) {
  return (
    <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:px-0">
      {KANBAN_COLUMNS.map((col) => {
        const items = companies.filter((c) => col.stages.includes(c.stage));
        return (
          <section
            key={col.title}
            aria-label={col.title}
            className="w-64 shrink-0 snap-start rounded-2xl border border-border bg-surface/50 p-3"
          >
            <h2 className="mb-2 flex items-center justify-between text-sm font-semibold">
              {col.title} <span className="text-xs text-muted">{items.length}</span>
            </h2>
            <ul className="flex flex-col gap-2">
              {items.map((c) => (
                <li key={c.id}>
                  <Link
                    to={`/crm/${c.id}`}
                    className={cn(
                      'block rounded-xl bg-surface-2 p-2.5 text-sm hover:ring-1 hover:ring-violet/40',
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium">{c.name}</span>
                      <ScoreBadge score={c.score} className="h-6 min-w-9" />
                    </div>
                    <p className="mt-1 truncate text-xs text-muted">{nextStepText(c)}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
