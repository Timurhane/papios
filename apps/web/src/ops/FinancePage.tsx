import { formatTl, localDate } from '@papi/core';
import { useState } from 'react';
import { Link } from 'react-router';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import type { PaymentItem } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { cn } from '@/lib/utils';

const today = () => localDate(new Date(), 'Europe/Istanbul');
const KIND = { setup: 'Kurulum', monthly: 'Aylık', project: 'Proje', other: 'Diğer' } as const;

/** Finans (K-13.8): MRR and target, open charges, this month's income and expenses. */
export function FinancePage() {
  const api = usePanelApi();
  const { data, error, loading, reload } = useAsync(() => api.financeSummary(), 'finance');
  const [now] = useState(today);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Finans</h1>
      <ErrorText>{error}</ErrorText>
      {loading && (
        <p className="text-sm text-muted" role="status">
          Yükleniyor…
        </p>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs text-muted">Aylık yinelenen gelir</p>
              <p className="text-2xl font-semibold tabular-nums">{formatTl(data.mrrKurus)}</p>
              {data.targetKurus ? (
                <p className="text-xs text-muted">
                  Hedefe kalan: {formatTl(Math.max(0, data.targetKurus - data.mrrKurus))}
                </p>
              ) : (
                <p className="text-xs text-muted">Hedef ayarlanmadı</p>
              )}
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted">Bu ay gelir</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatTl(data.monthIncomeKurus)}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs text-muted">Bu ay gider</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatTl(data.monthExpenseKurus)}
              </p>
            </Card>
          </div>
          <Card className="flex flex-col gap-2 p-4 sm:p-6">
            <h2 className="font-semibold">Açık tahsilatlar ({data.open.length})</h2>
            {data.open.length === 0 ? (
              <p className="text-sm text-muted">Açık tahsilat yok.</p>
            ) : (
              <ul className="flex flex-col gap-2" aria-label="Açık tahsilatlar">
                {data.open.map((p) => (
                  <PaymentRow key={p.id} payment={p} late={p.due_on < now} onChanged={reload} />
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Ödeme linki ve fatura şimdilik elle (iyzico/PayTR adaptörü kapalı).
            </p>
          </Card>
          <EntryForm onAdded={reload} />
          {data.entries.length > 0 && (
            <Card className="p-4 sm:p-6">
              <h2 className="mb-2 font-semibold">Bu ayın kayıtları</h2>
              <ul className="space-y-1 text-sm tabular-nums">
                {data.entries.map((e) => (
                  <li key={e.id} className="flex justify-between gap-2">
                    <span>
                      {e.occurred_on} · {e.category}
                      {e.note ? ` · ${e.note}` : ''}
                    </span>
                    <span className={e.kind === 'income' ? 'text-emerald-500' : 'text-danger'}>
                      {e.kind === 'income' ? '+' : '−'}
                      {formatTl(e.amount_kurus)}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </section>
  );
}

function PaymentRow({
  payment: p,
  late,
  onChanged,
}: {
  payment: PaymentItem;
  late: boolean;
  onChanged: () => void;
}) {
  const api = usePanelApi();
  const [link, setLink] = useState(p.payment_link ?? '');
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-xl border border-border p-3 text-sm">
      <Link
        to={`/crm/${p.company_id}`}
        className="min-w-0 flex-1 truncate font-medium hover:underline"
      >
        {p.company_name}
      </Link>
      <span className="text-muted">{KIND[p.kind]}</span>
      <span className="tabular-nums">{formatTl(p.amount_kurus)}</span>
      <span className={cn('text-xs', late ? 'text-danger' : 'text-muted')}>
        vade {p.due_on}
        {late ? ' · gecikti' : ''}
      </span>
      <Input
        aria-label="Ödeme linki"
        className="h-9 w-48"
        placeholder="Ödeme linki"
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onBlur={() => link !== (p.payment_link ?? '') && api.setPaymentLink(p.id, link || null)}
      />
      <Button
        size="sm"
        onClick={async () => {
          await api.markPaymentPaid(p.id, today());
          onChanged();
        }}
      >
        Ödendi
      </Button>
    </li>
  );
}

function EntryForm({ onAdded }: { onAdded: () => void }) {
  const api = usePanelApi();
  const [kind, setKind] = useState<'income' | 'expense'>('expense');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const tl = Number(amount.replace(/\./g, '').replace(',', '.'));
  return (
    <Card className="flex flex-col gap-3 p-4 sm:p-6">
      <h2 className="font-semibold">Gelir / gider ekle</h2>
      <div className="flex flex-wrap gap-2">
        <select
          aria-label="Tür"
          className="h-11 rounded-xl border border-border bg-surface-2 px-3"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'income' | 'expense')}
        >
          <option value="expense">Gider</option>
          <option value="income">Gelir</option>
        </select>
        <Input
          aria-label="Kategori"
          className="w-40"
          placeholder="Kategori"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        />
        <Input
          aria-label="Tutar (TL)"
          className="w-32"
          inputMode="decimal"
          placeholder="Tutar (TL)"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Input
          aria-label="Not"
          className="min-w-40 flex-1"
          placeholder="Not"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <ErrorText>{error}</ErrorText>
      <Button
        size="sm"
        disabled={!category.trim() || !(tl > 0)}
        onClick={async () => {
          try {
            await api.addFinanceEntry({
              kind,
              category: category.trim(),
              amount_kurus: Math.round(tl * 100),
              occurred_on: today(),
              note: note.trim() || null,
            });
            setCategory('');
            setAmount('');
            setNote('');
            onAdded();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          }
        }}
      >
        Ekle
      </Button>
    </Card>
  );
}
