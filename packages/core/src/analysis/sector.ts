import { foldTurkish } from '../crm/normalize.ts';

export type SectorTier = 'high' | 'medium' | 'low';

export interface SectorMatch {
  code: string;
  label: string;
  tier: SectorTier;
}

/**
 * Sector rules. High tier = high value per customer (K-6.5): real estate, clinics, car dealers,
 * construction/renovation, private education, hotels, manufacturers.
 */
const RULES: { code: string; label: string; tier: SectorTier; keywords: string[] }[] = [
  {
    code: 'real_estate',
    label: 'Emlak',
    tier: 'high',
    keywords: ['emlak', 'gayrimenkul', 'real estate', 'satilik daire', 'kiralik'],
  },
  {
    code: 'clinic',
    label: 'Klinik / sağlık',
    tier: 'high',
    keywords: [
      'klini',
      'dis hekim',
      'dental',
      'estetik',
      'poliklini',
      'tip merkez',
      'hastane',
      'fizik tedavi',
      'implant',
      'ortodonti',
      'dermatoloji',
      'goz merkez',
    ],
  },
  {
    code: 'auto',
    label: 'Oto galeri / bayi',
    tier: 'high',
    keywords: [
      'oto galeri',
      'otomotiv',
      'yetkili bayi',
      'ikinci el arac',
      'sifir arac',
      'otomobil',
      'oto ekspertiz',
      'rent a car',
    ],
  },
  {
    code: 'construction',
    label: 'İnşaat / tadilat',
    tier: 'high',
    keywords: [
      'insaat',
      'tadilat',
      'dekorasyon',
      'yapi',
      'mimarlik',
      'muteahhit',
      'konut projesi',
      'boya badana',
      'mutfa',
    ],
  },
  {
    code: 'education',
    label: 'Özel eğitim',
    tier: 'high',
    keywords: [
      'kolej',
      'ozel okul',
      'kurs',
      'dershane',
      'egitim merkezi',
      'anaokulu',
      'kres',
      'dil okulu',
      'etut',
    ],
  },
  {
    code: 'hotel',
    label: 'Otel / konaklama',
    tier: 'high',
    keywords: ['otel', 'hotel', 'pansiyon', 'resort', 'konaklama', 'apart'],
  },
  {
    code: 'manufacturing',
    label: 'Üretim / OSB',
    tier: 'high',
    keywords: [
      'fabrika',
      'uretim',
      'imalat',
      'organize sanayi',
      'osb',
      'sanayi',
      'makine',
      'ihracat',
    ],
  },
  {
    code: 'legal_finance',
    label: 'Hukuk / mali müşavirlik',
    tier: 'medium',
    keywords: ['avukat', 'hukuk burosu', 'mali musavir', 'muhasebe', 'sigorta'],
  },
  {
    code: 'beauty',
    label: 'Güzellik / bakım',
    tier: 'medium',
    keywords: ['guzellik merkezi', 'kuafor', 'berber', 'lazer epilasyon', 'cilt bakim', 'spa'],
  },
  {
    code: 'food',
    label: 'Yeme-içme',
    tier: 'medium',
    keywords: ['restoran', 'restaurant', 'kafe', 'cafe', 'pastane', 'catering'],
  },
  {
    code: 'retail',
    label: 'Perakende',
    tier: 'low',
    keywords: ['magaza', 'butig', 'butik', 'giyim', 'market', 'eczane'],
  },
];

/**
 * Keywords are stems matched at word starts, so Turkish suffixes still match; stems avoid the final
 * consonant that mutates (klinik → kliniği, mutfak → mutfağı).
 */
/** Rule-based sector detection; returns null when no rule matches (the model may decide later). */
export function detectSector(...texts: (string | null | undefined)[]): SectorMatch | null {
  const hay = ` ${foldTurkish(texts.filter(Boolean).join(' ')).replace(/[^a-z0-9]+/g, ' ')} `;
  let best: { rule: (typeof RULES)[number]; hits: number } | null = null;
  for (const rule of RULES) {
    const hits = rule.keywords.filter((k) => hay.includes(` ${k}`)).length;
    if (hits > 0 && (!best || hits > best.hits)) best = { rule, hits };
  }
  return best ? { code: best.rule.code, label: best.rule.label, tier: best.rule.tier } : null;
}

export function tierForSectorLabel(label: string | null): SectorTier | null {
  if (!label) return null;
  return detectSector(label)?.tier ?? null;
}
