import { scoreTone } from '@/crm/labels';
import type { MapCompany } from '@/data/types';

const TONE = { hot: '#dc2626', warm: '#d97706', cold: '#2563eb', none: '#6b7280' } as const;
export const STAGE_COLOR = { won: '#16a34a' } as const;

/** Marker colour: clients green, otherwise by score (hot ≥ 70, warm ≥ 50). */
export function markerColor(c: Pick<MapCompany, 'score' | 'stage'>): string {
  return c.stage === 'won' ? STAGE_COLOR.won : TONE[scoreTone(c.score)];
}

export const LEGEND = [
  { label: 'Sıcak (70+)', color: TONE.hot },
  { label: 'Ilık (50–69)', color: TONE.warm },
  { label: 'Soğuk', color: TONE.cold },
  { label: 'Müşteri', color: STAGE_COLOR.won },
];
