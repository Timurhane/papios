import { useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { usePanelApi } from '@/data/PanelApiContext';
import { useAsync } from '@/data/useAsync';
import { formatDateTime } from '@/outreach/labels';

export function tagsOf(text: string): string[] {
  return [
    ...new Set(
      [...text.matchAll(/#([\p{L}\d_-]{2,30})/gu)].map((m) => (m[1] ?? '').toLocaleLowerCase('tr')),
    ),
  ];
}

/** Notlar (K-13.2): ideas, meeting and voice notes; search by text or #tag. */
export function NotesPage() {
  const api = usePanelApi();
  const [q, setQ] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const { data, reload } = useAsync(() => api.listNotes(q), `notes:${q}`);
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">Notlar</h1>
      <Card className="flex flex-col gap-2 p-4">
        <textarea
          aria-label="Yeni not"
          className="min-h-24 w-full rounded-xl border border-border bg-surface-2 p-3 text-sm"
          placeholder="Not yaz… (#etiket ekleyebilirsin; Telegram'da /not ile de olur)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <ErrorText>{error}</ErrorText>
        <Button
          size="sm"
          disabled={!body.trim()}
          onClick={async () => {
            try {
              await api.addNote(body.trim(), tagsOf(body));
              setBody('');
              reload();
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          Kaydet
        </Button>
      </Card>
      <Input
        placeholder="Ara (metin ya da #etiket)"
        aria-label="Notlarda ara"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <ul className="flex flex-col gap-2" aria-label="Notlar">
        {data?.map((n) => (
          <li key={n.id}>
            <Card className="p-4 text-sm">
              <p className="whitespace-pre-wrap">{n.body}</p>
              <p className="mt-2 text-xs text-muted">
                {formatDateTime(n.created_at)} ·{' '}
                {n.source === 'panel'
                  ? 'panel'
                  : n.source === 'telegram_voice'
                    ? 'sesli not'
                    : 'Telegram'}
                {n.tags.length ? ` · ${n.tags.map((t) => `#${t}`).join(' ')}` : ''}
              </p>
            </Card>
          </li>
        ))}
      </ul>
      {data?.length === 0 && <p className="text-sm text-muted">Not bulunamadı.</p>}
    </section>
  );
}
