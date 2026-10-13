import type { CompanySummary, Stage } from '@/data/types';

export const STAGE_LABEL: Record<Stage, string> = {
  new: 'Yeni',
  analyzing: 'Analizde',
  analyzed: "Playbook'a hazır",
  waitlist: 'Bekleme listesi',
  in_playbook: "Playbook'ta",
  replied: 'Cevap verdi',
  meeting: 'Görüşme',
  proposal: 'Teklif',
  won: 'Kazanıldı',
  lost: 'Kaybedildi',
  closed: 'Kapalı',
};

export const PLAYBOOK_LABEL: Record<string, string> = {
  soguk_ana: 'Soğuk Ana',
  hafif_soguk: 'Hafif Soğuk',
  sinyal: 'Sinyal',
  sicak_gelen: 'Sıcak Gelen',
  ziyaret_sonrasi: 'Ziyaret Sonrası',
  teklif_takibi: 'Teklif Takibi',
  uyandirma: 'Uyandırma',
  simdi_degil: 'Şimdi Değil',
  referans: 'Referans',
  referans_ortak: 'Referans — Ortaklar',
  musteri_yasami: 'Müşteri Yaşamı',
};

/** Kanban columns: neighbouring stages are grouped to keep the board readable on a phone. */
export const KANBAN_COLUMNS: { title: string; stages: Stage[] }[] = [
  { title: 'Yeni / analizde', stages: ['new', 'analyzing'] },
  { title: "Playbook'a hazır", stages: ['analyzed'] },
  { title: "Playbook'ta", stages: ['in_playbook'] },
  { title: 'Cevap verdi', stages: ['replied'] },
  { title: 'Görüşme / teklif', stages: ['meeting', 'proposal'] },
  { title: 'Kazanıldı', stages: ['won'] },
  { title: 'Bekleme listesi', stages: ['waitlist'] },
  { title: 'Kapalı', stages: ['lost', 'closed'] },
];

export function formatDate(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
}

/** K-2.5: the next step is always shown. */
export function nextStepText(
  c: Pick<
    CompanySummary,
    'next_step_kind' | 'assigned_playbook' | 'waiting_reason' | 'waiting_until'
  >,
): string {
  if (c.next_step_kind === 'playbook')
    return `Playbook: ${PLAYBOOK_LABEL[c.assigned_playbook ?? ''] ?? c.assigned_playbook ?? '—'}`;
  if (c.next_step_kind === 'closed') return 'Kapalı';
  return `${c.waiting_reason ?? 'Bekliyor'}${c.waiting_until ? ` · ${formatDate(c.waiting_until)}` : ''}`;
}

export function scoreTone(score: number | null): 'hot' | 'warm' | 'cold' | 'none' {
  if (score === null) return 'none';
  if (score >= 70) return 'hot';
  if (score >= 50) return 'warm';
  return 'cold';
}
