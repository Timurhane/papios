import { ArrowLeft, ExternalLink } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { usePanelApi } from '@/data/PanelApiContext';
import type { CompanyDetail } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { CompanySalesCard } from '@/sales/CompanySalesCard';
import { formatDate, nextStepText, STAGE_LABEL } from './labels';
import { ScoreBadge } from './ScoreBadge';

export function CompanyPage() {
  const { id = '' } = useParams();
  const api = usePanelApi();
  const { data, error, loading, reload } = useAsync(() => api.getCompany(id), `company:${id}`);

  return (
    <section className="flex flex-col gap-5">
      <Link
        to="/crm"
        className="inline-flex items-center gap-1 text-sm text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden /> CRM
      </Link>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {!loading && !data && !error && <p className="text-muted">Firma bulunamadı.</p>}
      {data && <CompanyCard company={data} onChanged={reload} />}
      {data && <CompanySalesCard companyId={data.id} />}
    </section>
  );
}

function ScoreBar({ label, value, max }: { label: string; value: number | null; max: number }) {
  const pct = value === null ? 0 : Math.round((value / max) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="tabular-nums">
          {value ?? '—'}/{max}
        </span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-surface-2">
        <div
          className="h-1.5 rounded-full bg-gradient-to-r from-violet to-blue"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function CompanyCard({ company: c, onChanged }: { company: CompanyDetail; onChanged: () => void }) {
  const links = [
    c.website_url && { href: c.website_url, label: c.domain ?? 'Web sitesi' },
    c.instagram_handle && {
      href: `https://instagram.com/${c.instagram_handle}`,
      label: `@${c.instagram_handle}`,
    },
    c.maps_url && { href: c.maps_url, label: 'Harita' },
  ].filter((l): l is { href: string; label: string } => Boolean(l));
  const mobile = c.analysis?.pagespeed?.mobile?.performance ?? null;
  const desktop = c.analysis?.pagespeed?.desktop?.performance ?? null;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[c.sector, c.city, STAGE_LABEL[c.stage]].filter(Boolean).join(' · ')}
          </p>
          <div className="mt-2 flex flex-wrap gap-3 text-sm">
            {links.map((l) => (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 text-violet hover:underline"
              >
                {l.label} <ExternalLink className="h-3 w-3" aria-hidden />
              </a>
            ))}
          </div>
        </div>
        <ScoreBadge score={c.score} className="h-12 min-w-16 text-lg" />
      </header>

      <NextStepCard company={c} onChanged={onChanged} />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="flex flex-col gap-4">
          <h2 className="font-semibold">Puan ve gerekçesi</h2>
          <div className="grid gap-3">
            <ScoreBar label="Uygunluk" value={c.score_fit} max={40} />
            <ScoreBar label="Dert" value={c.score_pain} max={40} />
            <ScoreBar label="Ulaşılabilirlik" value={c.score_reach} max={20} />
          </div>
          <ul className="flex flex-col gap-1 text-sm" aria-label="Puan gerekçesi">
            {c.score_rationale.map((r) => (
              <li key={r} className="text-muted">
                {r}
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Analiz</h2>
          {!c.analysis && <p className="text-sm text-muted">Henüz analiz yok.</p>}
          {c.analysis?.strongest_finding && (
            <p className="rounded-xl bg-violet/10 p-3 text-sm ring-1 ring-violet/30">
              💡 {c.analysis.strongest_finding}
            </p>
          )}
          {c.analysis && c.analysis.findings.length > 0 && (
            <ul className="list-disc space-y-1 pl-5 text-sm">
              {c.analysis.findings.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
          {c.analysis && (
            <p className="text-xs text-muted">
              PageSpeed mobil: {mobile ?? '—'} · masaüstü: {desktop ?? '—'} ·{' '}
              {c.analysis.kind === 'deep' ? 'derin tarama' : 'hızlı analiz'},{' '}
              {formatDate(c.analysis.created_at)}
              {c.analysis.status === 'partial' && ' · yapay zeka özeti eksik'}
            </p>
          )}
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">İletişim</h2>
          <ul className="space-y-1 text-sm">
            {c.phone_e164 && <li>Telefon: +{c.phone_e164}</li>}
            {c.emails.map((e) => (
              <li key={e}>E-posta: {e}</li>
            ))}
            {c.contacts.map((p) => (
              <li key={p.id}>
                {p.full_name ?? 'Kişi'}
                {p.is_decision_maker && (
                  <span className="ml-2 rounded-full bg-violet/15 px-2 py-0.5 text-xs text-violet">
                    karar verici
                  </span>
                )}
              </li>
            ))}
            {!c.phone_e164 && c.emails.length === 0 && c.contacts.length === 0 && (
              <li className="text-muted">İletişim bilgisi bulunamadı.</li>
            )}
          </ul>
          <DeletePersonalData companyId={c.id} onDone={onChanged} />
        </Card>

        <Card className="flex flex-col gap-3">
          <h2 className="font-semibold">Zaman çizelgesi</h2>
          <ol className="space-y-2 text-sm" aria-label="Zaman çizelgesi">
            {c.events.map((e) => (
              <li key={e.id} className="flex gap-3">
                <span className="w-24 shrink-0 text-xs text-muted">
                  {formatDate(e.occurred_at)}
                </span>
                <span>{e.summary}</span>
              </li>
            ))}
            {c.events.length === 0 && <li className="text-muted">Kayıt yok.</li>}
          </ol>
        </Card>
      </div>
    </>
  );
}

/** K-17.7: one-click deletion (with a confirmation step; cannot be undone). */
function DeletePersonalData({ companyId, onDone }: { companyId: string; onDone: () => void }) {
  const api = usePanelApi();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!confirming)
    return (
      <Button variant="ghost" size="sm" className="self-start" onClick={() => setConfirming(true)}>
        Kişisel verileri sil (KVKK)
      </Button>
    );
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border p-3 text-sm">
      <p>
        Kişiler, e-posta ve telefonlar, mesaj içerikleri silinir; adresler reddedenler listesine
        eklenir ve kayıt kapanır. Geri alınamaz.
      </p>
      <div className="flex gap-2">
        <Button
          size="sm"
          onClick={async () => {
            try {
              await api.deleteCompanyPersonalData(companyId);
              setConfirming(false);
              onDone();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Evet, sil
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
          Vazgeç
        </Button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** K-2.5: the next step is always visible and can only be changed to another valid next step. */
function NextStepCard({
  company: c,
  onChanged,
}: {
  company: CompanyDetail;
  onChanged: () => void;
}) {
  const api = usePanelApi();
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState(() =>
    new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  );
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.setNextStep(c.id, { kind: 'waiting', reason: reason.trim(), until });
      setEditing(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Kaydedilemedi.');
    }
  }

  async function close() {
    await api.setNextStep(c.id, { kind: 'closed' });
    onChanged();
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs tracking-wide text-muted uppercase">Sıradaki adım</p>
          <p className="font-medium">{nextStepText(c)}</p>
        </div>
        {!editing && c.next_step_kind !== 'closed' && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Beklemeye al
            </Button>
            <Button variant="ghost" size="sm" onClick={() => void close()}>
              Kapat
            </Button>
          </div>
        )}
      </div>
      {editing && (
        <form onSubmit={save} className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="flex flex-col gap-1">
            <Label htmlFor="reason">Bekleme nedeni</Label>
            <Input
              id="reason"
              required
              minLength={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor="until">Tarih</Label>
            <Input
              id="until"
              type="date"
              required
              value={until}
              onChange={(e) => setUntil(e.target.value)}
            />
          </div>
          <Button type="submit" size="sm">
            Kaydet
          </Button>
        </form>
      )}
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}
