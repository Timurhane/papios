import { founderDiscountFor, quotePaths, type VatMode } from '@papi/core';
import { ArrowLeft } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { ProposalDetail, SalesContext } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';
import { PROPOSAL_STATUS, STATUS_TONE } from './labels';
import { makeProposalPdf } from './make-pdf';
import { VatChoice } from './NewProposalPage';
import { asQuote, QuoteView } from './QuoteView';

export function ProposalPage() {
  const { id = '' } = useParams();
  const api = usePanelApi();
  const p = useAsync(() => api.getProposal(id), `proposal:${id}`);
  const ctx = useAsync(() => api.salesContext(), 'sales-context');
  return (
    <section className="flex flex-col gap-5">
      <Link
        to="/teklifler"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> Teklifler
      </Link>
      <ErrorText>{p.error ?? ctx.error}</ErrorText>
      {(p.loading || ctx.loading) && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {!p.loading && !p.data && !p.error && <p className="text-muted">Teklif bulunamadı.</p>}
      {p.data && ctx.data && <ProposalView proposal={p.data} ctx={ctx.data} onChanged={p.reload} />}
    </section>
  );
}

function ProposalView({
  proposal: p,
  ctx,
  onChanged,
}: {
  proposal: ProposalDetail;
  ctx: SalesContext;
  onChanged: () => void;
}) {
  const api = usePanelApi();
  const pkg = ctx.packages.find((x) => x.code === p.package_code);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const quote = asQuote(p.quote);

  async function createPdf() {
    if (!quote || !p.vat_mode) return;
    const bytes = await makeProposalPdf({
      number: p.number,
      date: p.created_at.slice(0, 10),
      validUntil: p.valid_until,
      companyName: p.company_name,
      packageName: pkg?.name ?? p.package_code,
      packageSummary: pkg?.summary ?? '',
      intro: p.intro ?? '',
      scope: p.scope,
      vatMode: p.vat_mode,
      quote,
      founderDiscount: p.founder_discount !== null,
    });
    const path = await api.saveProposalPdf(p.id, bytes);
    setPdfUrl(await api.proposalPdfUrl(path));
  }

  async function openPdf() {
    if (!p.pdf_path) return;
    const url = pdfUrl ?? (await api.proposalPdfUrl(p.pdf_path));
    setPdfUrl(url);
    window.open(url, '_blank', 'noopener');
  }

  const waText = pdfUrl
    ? `Merhaba, görüşmemize göre hazırladığım teklif (${p.number}): ${pdfUrl}`
    : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex flex-col gap-2 p-4 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold">{p.number}</h1>
          <span className={cn('rounded-full px-2 py-0.5 text-xs', STATUS_TONE[p.status])}>
            {PROPOSAL_STATUS[p.status]}
          </span>
        </div>
        <Link to={`/crm/${p.company_id}`} className="font-medium hover:underline">
          {p.company_name}
        </Link>
        <p className="text-sm text-muted">
          {pkg?.name ?? p.package_code} · geçerlilik {p.valid_until}
        </p>
      </Card>

      {p.status === 'draft' ? (
        <DraftEditor proposal={p} ctx={ctx} busy={busy} run={run} />
      ) : (
        <Card className="flex flex-col gap-3 p-4 sm:p-6">
          <p className="whitespace-pre-wrap text-sm">{p.intro}</p>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {p.scope.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {quote && <QuoteView quote={quote} vat={p.vat_mode} />}
          {p.founder_discount && (
            <p className="text-xs text-muted">Kurucu müşteri indirimi uygulandı.</p>
          )}
        </Card>
      )}

      <ErrorText>{error}</ErrorText>

      {p.status === 'awaiting_approval' && (
        <p className="text-sm text-muted">
          Onay bekliyor: Bugün ekranından veya Telegram'dan (/onaylar) onaylayabilirsin.
        </p>
      )}

      {(p.status === 'approved' || p.status === 'sent' || p.status === 'accepted') && (
        <Card className="flex flex-col gap-3 p-4 sm:p-6">
          <h2 className="font-semibold">PDF ve gönderim</h2>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => run(createPdf)}>
              {p.pdf_path ? "PDF'i yeniden oluştur" : 'PDF oluştur'}
            </Button>
            {p.pdf_path && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => run(openPdf)}>
                PDF'i aç
              </Button>
            )}
            {waText && p.company_phone && p.status === 'approved' && (
              <a
                href={`https://wa.me/${p.company_phone}?text=${encodeURIComponent(waText)}`}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-9 items-center rounded-xl border border-border bg-surface px-3 text-sm hover:bg-surface-2"
              >
                WhatsApp'ta gönder
              </a>
            )}
          </div>
          {p.status === 'approved' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !p.pdf_path || !api.workerAvailable()}
                onClick={() => run(() => api.worker('proposal.sent', { proposalId: p.id }))}
              >
                Gönderildi olarak işaretle
              </Button>
              <span className="text-xs text-muted">
                Teklif Takibi dizisi başlar. (Mail bağlanınca Papi kendisi gönderecek.)
              </span>
            </div>
          )}
          {p.status === 'sent' && (
            <div className="flex flex-wrap gap-2">
              {(quote?.kind === 'paths'
                ? ([
                    ['no_setup', 'Kabul edildi (kurulumsuz)'],
                    ['setup', 'Kabul edildi (kurulumlu)'],
                  ] as const)
                : ([[null, 'Kabul edildi']] as const)
              ).map(([path, label]) => (
                <Button
                  key={label}
                  size="sm"
                  disabled={busy || !api.workerAvailable()}
                  onClick={() =>
                    run(() =>
                      api.worker('proposal.close', {
                        proposalId: p.id,
                        outcome: 'accepted',
                        ...(path ? { path } : {}),
                      }),
                    )
                  }
                >
                  {label}
                </Button>
              ))}
              <Button
                size="sm"
                variant="ghost"
                disabled={busy || !api.workerAvailable()}
                onClick={() =>
                  run(() => api.worker('proposal.close', { proposalId: p.id, outcome: 'rejected' }))
                }
              >
                Reddedildi
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function DraftEditor({
  proposal: p,
  ctx,
  busy,
  run,
}: {
  proposal: ProposalDetail;
  ctx: SalesContext;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  const api = usePanelApi();
  const [intro, setIntro] = useState(p.intro ?? '');
  const [scope, setScope] = useState(p.scope.join('\n'));
  const [vat, setVat] = useState<VatMode | null>(p.vat_mode);
  const [founderOn, setFounderOn] = useState(p.founder_discount !== null);
  const [setupPct, setSetupPct] = useState(
    p.founder_discount?.setupPct ?? ctx.founder?.setupMaxPct ?? 0,
  );
  const isPaths = p.quote.kind === 'paths' && p.monthly_kurus !== null;
  // K-7.5: offered only while a slot is really free (or already granted on this draft)
  const founderAvailable = (ctx.founder?.slotsLeft ?? 0) > 0 || p.founder_discount !== null;
  const founder =
    isPaths && founderOn && ctx.founder
      ? founderDiscountFor(
          { ...ctx.founder, slotsLeft: Math.max(ctx.founder.slotsLeft, 1) },
          { setupPct },
        )
      : null;
  const quote =
    isPaths && p.monthly_kurus !== null
      ? { kind: 'paths' as const, ...quotePaths(p.monthly_kurus, ctx.pricing, founder) }
      : asQuote(p.quote);

  const patch = () => ({
    intro: intro.trim(),
    scope: scope
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
    ...(vat ? { vat_mode: vat } : {}),
    ...(isPaths && quote ? { quote, founder_discount: founder } : {}),
  });

  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6">
      <label className="text-sm">
        Giriş paragrafı
        <textarea
          aria-label="Giriş paragrafı"
          className="mt-1 min-h-28 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
        />
      </label>
      <label className="text-sm">
        Kapsam (her satır bir madde)
        <textarea
          aria-label="Kapsam"
          className="mt-1 min-h-24 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        />
      </label>
      {isPaths && founderAvailable && ctx.founder && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={founderOn}
              onChange={(e) => setFounderOn(e.target.checked)}
            />
            Kurucu müşteri indirimi ({ctx.founder.slotsLeft} kontenjan kaldı)
          </label>
          {founderOn && (
            <label className="flex items-center gap-2">
              Kurulum indirimi %
              <input
                aria-label="Kurulum indirimi"
                type="number"
                min={0}
                max={ctx.founder.setupMaxPct}
                className="h-9 w-20 rounded-lg border border-border bg-surface-2 px-2"
                value={setupPct}
                onChange={(e) => setSetupPct(Number(e.target.value))}
              />
            </label>
          )}
        </div>
      )}
      {quote && <QuoteView quote={quote} vat={vat} />}
      <VatChoice value={vat} onChange={setVat} />
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => run(() => api.updateProposal(p.id, patch()))}
        >
          Kaydet
        </Button>
        <Button
          size="sm"
          disabled={busy || !vat || !intro.trim() || !api.workerAvailable()}
          onClick={() =>
            run(async () => {
              await api.updateProposal(p.id, patch());
              await api.worker('proposal.submit', { proposalId: p.id });
            })
          }
        >
          Onaya gönder
        </Button>
      </div>
    </Card>
  );
}
