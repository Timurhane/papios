import type { Settings } from '../settings/schema.ts';
import type { SectorTier } from './sector.ts';

export interface ScoreInput {
  sectorTier: SectorTier | null;
  sectorLabel: string | null;
  regionPriority: number | null;
  maxRegionPriority: number;
  size: { branches: boolean; manyChannels: boolean };
  site: {
    exists: boolean;
    https: boolean;
    mobilePerformance: number | null;
    whatsapp: boolean;
    booking: boolean;
    onlineOrder: boolean;
    contactForm: boolean;
    chatWidget: boolean;
    socialCount: number;
    stale: boolean;
  };
  activeSignals: string[];
  reach: { phone: boolean; email: boolean; decisionMaker: boolean; channels: number };
}

export interface ScoreResult {
  total: number;
  fit: number;
  pain: number;
  reach: number;
  rationale: string[];
}

type Line = { pts: number; text: string };

/** Points before scaling; each block's maximum maps to the configured weight (K-9.3). */
const MAX = { fit: 40, pain: 40, reach: 20 };

function fitLines(i: ScoreInput): Line[] {
  const lines: Line[] = [];
  const sector = { high: 22, medium: 12, low: 5 } as const;
  if (i.sectorTier)
    lines.push({
      pts: sector[i.sectorTier],
      text: `${i.sectorLabel ?? 'Sektör'}: ${i.sectorTier === 'high' ? 'müşteri başı değeri yüksek' : i.sectorTier === 'medium' ? 'orta değerli' : 'düşük değerli'} sektör`,
    });
  else lines.push({ pts: 8, text: 'Sektör belirsiz' });
  if (i.size.branches) lines.push({ pts: 6, text: 'Birden fazla şube' });
  if (i.size.manyChannels)
    lines.push({ pts: 2, text: 'Çok kanallı dijital varlık (büyüklük sinyali)' });
  if (i.regionPriority !== null) {
    const steps = Math.max(1, i.maxRegionPriority);
    const pts = Math.round(10 * (1 - (i.regionPriority - 1) / steps));
    lines.push({ pts, text: `Bölge önceliği ${i.regionPriority}` });
  }
  return lines;
}

function painLines(i: ScoreInput): Line[] {
  const s = i.site;
  const lines: Line[] = [];
  if (!s.exists) {
    lines.push({ pts: 14, text: 'Web sitesi yok veya açılmıyor' });
  } else {
    if (s.mobilePerformance !== null && s.mobilePerformance < 50)
      lines.push({ pts: 8, text: `Mobil hız düşük (${s.mobilePerformance}/100)` });
    else if (s.mobilePerformance !== null && s.mobilePerformance < 70)
      lines.push({ pts: 4, text: `Mobil hız orta (${s.mobilePerformance}/100)` });
    if (!s.https) lines.push({ pts: 4, text: 'SSL yok (http)' });
    if (!s.contactForm) lines.push({ pts: 3, text: 'İletişim formu yok' });
    if (!s.chatWidget) lines.push({ pts: 3, text: 'Sitede canlı sohbet/asistan yok' });
    if (s.stale) lines.push({ pts: 2, text: 'Site uzun süredir güncellenmemiş görünüyor' });
  }
  if (!s.whatsapp) lines.push({ pts: 6, text: 'WhatsApp butonu/linki yok' });
  if (!s.booking && !s.onlineOrder) lines.push({ pts: 6, text: 'Online randevu veya sipariş yok' });
  if (s.socialCount === 0) lines.push({ pts: 3, text: 'Sosyal medya hesabı bulunamadı' });
  for (const sig of i.activeSignals.slice(0, 2))
    lines.push({ pts: 6, text: `Aktif sinyal: ${sig}` });
  return lines;
}

function reachLines(i: ScoreInput): Line[] {
  const r = i.reach;
  const lines: Line[] = [];
  if (r.phone) lines.push({ pts: 6, text: 'Telefon bulundu' });
  if (r.email) lines.push({ pts: 5, text: 'E-posta bulundu' });
  if (r.decisionMaker) lines.push({ pts: 5, text: 'Karar verici adı bulundu' });
  if (r.channels >= 3) lines.push({ pts: 4, text: `${r.channels} iletişim kanalı` });
  else if (r.channels === 2) lines.push({ pts: 2, text: '2 iletişim kanalı' });
  return lines;
}

function block(
  lines: Line[],
  max: number,
  weight: number,
  label: string,
  rationale: string[],
): number {
  const raw = Math.min(
    max,
    lines.reduce((s, l) => s + l.pts, 0),
  );
  const scaled = Math.round((raw / max) * weight);
  for (const l of lines)
    rationale.push(`${label} +${Math.round((l.pts / max) * weight)}: ${l.text}`);
  return scaled;
}

/** K-9.3 scoring with a Turkish, human-readable rationale (shown on the company card). */
export function computeScore(i: ScoreInput, cfg: Settings['scoring']): ScoreResult {
  const rationale: string[] = [];
  const fit = block(fitLines(i), MAX.fit, cfg.weights.fit, 'Uygunluk', rationale);
  const pain = block(painLines(i), MAX.pain, cfg.weights.pain, 'Dert', rationale);
  const reach = block(reachLines(i), MAX.reach, cfg.weights.reach, 'Ulaşılabilirlik', rationale);
  return { total: Math.min(100, fit + pain + reach), fit, pain, reach, rationale };
}

/** K-9.4: 70+ Soğuk Ana, 50–69 Hafif Soğuk, below 50 waitlist. */
export function playbookForScore(
  total: number,
  t: Settings['scoring']['thresholds'],
): 'soguk_ana' | 'hafif_soguk' | null {
  if (total >= t.cold_main) return 'soguk_ana';
  if (total >= t.light_cold) return 'hafif_soguk';
  return null;
}
