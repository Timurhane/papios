import { xIntentLink } from '@papi/core';
import { useState } from 'react';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePanelApi } from '@/data/PanelApiContext';
import type { ContentItem } from '@/data/types';
import { useAsync } from '@/data/useAsync';
import { formatDate } from '@/crm/labels';

const PLATFORM = { linkedin: 'LinkedIn', x: 'X', instagram: 'Instagram' } as const;
const STATUS = {
  awaiting_approval: 'Onay bekliyor',
  approved: 'Paylaşıma hazır',
  posted: 'Paylaşıldı',
  rejected: 'Reddedildi',
} as const;
/** LinkedIn and Instagram have no prefilled-text share link: copy, open, paste (K-13.9). */
const OPEN = {
  linkedin: { href: 'https://www.linkedin.com/feed/', label: "LinkedIn'i aç" },
  instagram: { href: 'https://www.instagram.com/', label: "Instagram'ı aç" },
} as const;

/** İçerik (K-13.9): Kalem's weekly drafts; approved ones are one tap from posting. */
export function ContentPage() {
  const api = usePanelApi();
  const { data, error, reload } = useAsync(() => api.listContent(), 'content');
  const weeks = [...new Set(data?.map((c) => c.week_of))];
  return (
    <section className="flex flex-col gap-5">
      <h1 className="text-2xl font-semibold tracking-tight">İçerik</h1>
      <p className="text-sm text-muted">
        Kalem her hafta marka bilgisinden taslak hazırlar; onay kuyruğundan geçenler burada
        paylaşıma hazır olur. Şehir adı geçen taslaklar otomatik elenir.
      </p>
      <ErrorText>{error}</ErrorText>
      {data?.length === 0 && <p className="text-sm text-muted">Henüz içerik taslağı yok.</p>}
      {weeks.map((w) => (
        <div key={w} className="flex flex-col gap-2">
          <h2 className="font-semibold">{formatDate(w)} haftası</h2>
          <ul className="grid gap-2 md:grid-cols-2" aria-label={`${formatDate(w)} haftası`}>
            {data
              ?.filter((c) => c.week_of === w)
              .map((c) => (
                <ContentCard key={c.id} item={c} onChanged={reload} />
              ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function ContentCard({ item: c, onChanged }: { item: ContentItem; onChanged: () => void }) {
  const api = usePanelApi();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <li>
      <Card className="flex h-full flex-col gap-2 p-4 text-sm">
        <p className="text-xs text-muted">
          {PLATFORM[c.platform]} · {STATUS[c.status]}
        </p>
        <p className="font-medium">{c.topic}</p>
        <p className="whitespace-pre-wrap">{c.body}</p>
        {c.status === 'approved' && (
          <div className="mt-auto flex flex-wrap gap-2 pt-2">
            {c.platform === 'x' ? (
              <a
                className="inline-flex h-9 items-center rounded-xl border border-border px-3"
                href={xIntentLink(c.body)}
                target="_blank"
                rel="noreferrer"
              >
                X'te paylaş
              </a>
            ) : (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={async () => {
                    await navigator.clipboard?.writeText(c.body).catch(() => undefined);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Kopyalandı' : 'Metni kopyala'}
                </Button>
                <a
                  className="inline-flex h-9 items-center rounded-xl border border-border px-3"
                  href={OPEN[c.platform].href}
                  target="_blank"
                  rel="noreferrer"
                >
                  {OPEN[c.platform].label}
                </a>
              </>
            )}
            <Button
              size="sm"
              onClick={async () => {
                try {
                  await api.markContentPosted(c.id);
                  onChanged();
                } catch (e) {
                  setError(e instanceof Error ? e.message : String(e));
                }
              }}
            >
              Paylaştım
            </Button>
          </div>
        )}
        {c.status === 'awaiting_approval' && (
          <p className="text-xs text-muted">Onay için Bugün ekranı veya Telegram /onaylar.</p>
        )}
        <ErrorText>{error}</ErrorText>
      </Card>
    </li>
  );
}
