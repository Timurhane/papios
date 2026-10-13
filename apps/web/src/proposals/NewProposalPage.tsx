import {
  addDays,
  formatTl,
  localDate,
  quoteProject,
  type ProjectPart,
  type VatMode,
} from '@papi/core';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import type { CompanySummary, SalesContext } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';
import { QuoteView } from './QuoteView';

/** New proposal: Satıcı drafts package proposals; custom (Özel) projects are priced here by parts. */
export function NewProposalPage() {
  const api = usePanelApi();
  const [params] = useSearchParams();
  const preset = params.get('firma');
  const ctx = useAsync(() => api.salesContext(), 'sales-context');
  const presetCompany = useAsync(
    () => (preset ? api.getCompany(preset) : Promise.resolve(null)),
    `preset:${preset ?? ''}`,
  );
  const [picked, setPicked] = useState<CompanySummary | null>(null);
  const company = picked ?? presetCompany.data;

  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Yeni teklif</h1>
      <ErrorText>{ctx.error}</ErrorText>
      {company ? (
        <Card className="flex items-center justify-between gap-3 p-4">
          <span className="font-medium">{company.name}</span>
          <Button size="sm" variant="ghost" onClick={() => setPicked(null)} disabled={!picked}>
            Değiştir
          </Button>
        </Card>
      ) : (
        <CompanyPicker onPick={setPicked} />
      )}
      {company && ctx.data && <PackageStep companyId={company.id} ctx={ctx.data} />}
    </section>
  );
}

function CompanyPicker({ onPick }: { onPick: (c: CompanySummary) => void }) {
  const api = usePanelApi();
  const [q, setQ] = useState('');
  const { data } = useAsync(() => api.listCompanies({ search: q }), `pick:${q}`);
  return (
    <Card className="p-4">
      <Input
        placeholder="Firma ara"
        aria-label="Firma ara"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto">
        {data?.slice(0, 20).map((c) => (
          <li key={c.id}>
            <button
              type="button"
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm hover:bg-surface-2"
              onClick={() => onPick(c)}
            >
              {c.name}
              {c.city ? <span className="text-muted"> · {c.city}</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function PackageStep({ companyId, ctx }: { companyId: string; ctx: SalesContext }) {
  const api = usePanelApi();
  const navigate = useNavigate();
  const [code, setCode] = useState<string | null>(null);
  const [monthlyTl, setMonthlyTl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pkg = ctx.packages.find((p) => p.code === code) ?? null;

  async function draft() {
    if (!pkg) return;
    setBusy(true);
    setError(null);
    try {
      const override = Number(monthlyTl.replace(/\./g, '').replace(',', '.'));
      const r = await api.worker<{ id: string }>('proposal.draft', {
        companyId,
        packageCode: pkg.code,
        ...(monthlyTl && override > 0 ? { monthlyKurus: Math.round(override * 100) } : {}),
      });
      navigate(`/teklifler/${r.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label="Paket">
        {ctx.packages.map((p) => (
          <button
            key={p.code}
            type="button"
            aria-pressed={code === p.code}
            onClick={() => setCode(p.code)}
            className={cn(
              'rounded-2xl border p-4 text-left',
              code === p.code ? 'border-violet bg-violet/10' : 'border-border hover:bg-surface-2',
            )}
          >
            <span className="font-semibold">{p.name}</span>
            <span className="ml-2 text-sm text-muted">
              {p.monthly_kurus
                ? `${formatTl(p.monthly_kurus)}${p.starting_from ? "'den" : ''} / ay`
                : 'Proje bazlı'}
            </span>
            <p className="mt-1 text-sm text-muted">{p.summary}</p>
          </button>
        ))}
      </div>
      <ErrorText>{error}</ErrorText>
      {pkg?.has_payment_paths && (
        <Card className="flex flex-col gap-3 p-4">
          {pkg.starting_from && (
            <label className="text-sm">
              Aylık ücret (TL, boş bırakırsan {formatTl(pkg.monthly_kurus ?? 0)})
              <Input
                inputMode="decimal"
                value={monthlyTl}
                onChange={(e) => setMonthlyTl(e.target.value)}
                aria-label="Aylık ücret"
              />
            </label>
          )}
          {!api.workerAvailable() && (
            <p className="text-sm text-amber-500">
              Sunucu bağlantısı (VITE_API_URL) kurulunca Satıcı taslağı buradan yazabilir.
            </p>
          )}
          <Button disabled={busy || !api.workerAvailable()} onClick={draft}>
            {busy ? 'Satıcı yazıyor…' : 'Satıcı taslağı hazırlasın'}
          </Button>
        </Card>
      )}
      {pkg && !pkg.has_payment_paths && <ProjectForm companyId={companyId} ctx={ctx} />}
    </>
  );
}

function ProjectForm({ companyId, ctx }: { companyId: string; ctx: SalesContext }) {
  const api = usePanelApi();
  const navigate = useNavigate();
  const [parts, setParts] = useState<ProjectPart[]>([{ title: '', days: 1 }]);
  const [intro, setIntro] = useState('');
  const [scope, setScope] = useState('');
  const [vat, setVat] = useState<VatMode | null>(
    ctx.vatDefault === 'unspecified' ? null : ctx.vatDefault,
  );
  const [error, setError] = useState<string | null>(null);
  const valid = parts.filter((p) => p.title.trim() && p.days > 0);

  let quote: ReturnType<typeof quoteProject> | null = null;
  let quoteError: string | null = null;
  if (valid.length) {
    try {
      quote = quoteProject(valid, ctx.pricing.custom_project);
    } catch (e) {
      quoteError = e instanceof Error ? e.message : String(e);
    }
  }

  async function save() {
    if (!quote || !vat) return;
    try {
      const id = await api.createProjectProposal({
        companyId,
        parts: valid,
        intro: intro.trim(),
        scope: scope
          .split('\n')
          .map((s) => s.trim())
          .filter(Boolean),
        vatMode: vat,
        quote: { kind: 'project', parts: valid, project: quote },
        validUntil: addDays(localDate(new Date(), 'Europe/Istanbul'), ctx.validDays),
      });
      navigate(`/teklifler/${id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <h2 className="font-semibold">İş parçaları</h2>
      {parts.map((p, i) => (
        <div key={i} className="flex gap-2">
          <Input
            aria-label={`Parça ${i + 1}`}
            placeholder="Ör. ERP entegrasyonu"
            value={p.title}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))
            }
          />
          <Input
            aria-label={`Parça ${i + 1} gün`}
            className="w-24"
            type="number"
            min={0.5}
            step={0.5}
            value={p.days}
            onChange={(e) =>
              setParts(parts.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) } : x)))
            }
          />
        </div>
      ))}
      <Button
        size="sm"
        variant="outline"
        onClick={() => setParts([...parts, { title: '', days: 1 }])}
      >
        Parça ekle
      </Button>
      {quoteError && <p className="text-sm text-danger">{quoteError}</p>}
      {quote && <QuoteView quote={{ kind: 'project', parts: valid, project: quote }} vat={vat} />}
      <label className="text-sm">
        Giriş paragrafı
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
        />
      </label>
      <label className="text-sm">
        Kapsam (her satır bir madde)
        <textarea
          className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </label>
      <VatChoice value={vat} onChange={setVat} />
      <ErrorText>{error}</ErrorText>
      <Button disabled={!quote || !vat || !intro.trim()} onClick={save}>
        Taslağı kaydet
      </Button>
    </Card>
  );
}

/** K-7.2 / A-6: asked on every proposal. */
export function VatChoice({
  value,
  onChange,
}: {
  value: VatMode | null;
  onChange: (v: VatMode) => void;
}) {
  return (
    <fieldset className="flex flex-wrap items-center gap-4 text-sm">
      <legend className="mb-1 w-full font-medium">Fiyatlar KDV dahil mi?</legend>
      {(
        [
          ['excluded', 'KDV hariç (+ KDV)'],
          ['included', 'KDV dahil'],
        ] as const
      ).map(([v, label]) => (
        <label key={v} className="flex items-center gap-2">
          <input type="radio" name="vat" checked={value === v} onChange={() => onChange(v)} />
          {label}
        </label>
      ))}
    </fieldset>
  );
}
