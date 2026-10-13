import { checkColdEmail } from '@papi/core';
import { useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import type { ApprovalItem } from '@/data/types';
import { CHANNEL_LABEL } from './labels';

/** One pending draft: read, edit, approve or reject from the panel (K-2.1, K-13.2). */
export function ApprovalCard({ item, onDone }: { item: ApprovalItem; onDone: () => void }) {
  const api = usePanelApi();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text ?? '');
  const [subject, setSubject] = useState(item.subject ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const edited =
    editing && (text.trim() !== (item.text ?? '').trim() || subject !== (item.subject ?? ''));
  const cold = item.maxWords !== null ? checkColdEmail(text, item.maxWords) : null;
  const tooLong = cold !== null && !cold.ok;

  async function decide(decision: 'approved' | 'rejected') {
    setBusy(true);
    setError(null);
    try {
      const ok = await api.decideApproval(
        item.id,
        decision,
        decision === 'approved' && edited
          ? { text, ...(item.subject !== null ? { subject } : {}) }
          : undefined,
      );
      if (!ok) setError('Bu iş artık beklemiyor (Telegram’dan karar verilmiş olabilir).');
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-xl border border-border p-3">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 text-left text-sm"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span>{item.title}</span>
        {item.channel && (
          <span className="shrink-0 text-xs text-muted">{CHANNEL_LABEL[item.channel]}</span>
        )}
      </button>
      {open && (
        <div className="mt-3 flex flex-col gap-3">
          {item.warnings.map((w) => (
            <p key={w} className="text-xs text-amber-500">
              ⚠️ {w}
            </p>
          ))}
          {editing ? (
            <>
              {item.subject !== null && (
                <Input
                  aria-label="Konu"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                />
              )}
              <textarea
                aria-label="Metin"
                className="min-h-48 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm focus:border-violet focus:outline-none"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </>
          ) : (
            <div className="rounded-xl bg-surface-2 p-3 text-sm">
              {item.subject && <p className="mb-2 font-medium">Konu: {item.subject}</p>}
              <p className="whitespace-pre-wrap">{item.text ?? '(metin yok)'}</p>
            </div>
          )}
          {cold && (
            <p className={tooLong ? 'text-xs text-danger' : 'text-xs text-muted'}>
              {cold.words}/{item.maxWords} kelime (soğuk mail sınırı)
            </p>
          )}
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy || tooLong} onClick={() => decide('approved')}>
              {edited ? 'Düzenlenmiş hâliyle onayla' : 'Onayla'}
            </Button>
            {!editing && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(true)}>
                Düzenle
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => decide('rejected')}>
              Reddet
            </Button>
          </div>
        </div>
      )}
    </li>
  );
}
