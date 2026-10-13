import { foldTurkish } from '../crm/normalize.ts';

export const PROVINCES = [
  'Adana',
  'Adıyaman',
  'Afyonkarahisar',
  'Ağrı',
  'Aksaray',
  'Amasya',
  'Ankara',
  'Antalya',
  'Ardahan',
  'Artvin',
  'Aydın',
  'Balıkesir',
  'Bartın',
  'Batman',
  'Bayburt',
  'Bilecik',
  'Bingöl',
  'Bitlis',
  'Bolu',
  'Burdur',
  'Bursa',
  'Çanakkale',
  'Çankırı',
  'Çorum',
  'Denizli',
  'Diyarbakır',
  'Düzce',
  'Edirne',
  'Elazığ',
  'Erzincan',
  'Erzurum',
  'Eskişehir',
  'Gaziantep',
  'Giresun',
  'Gümüşhane',
  'Hakkari',
  'Hatay',
  'Iğdır',
  'Isparta',
  'İstanbul',
  'İzmir',
  'Kahramanmaraş',
  'Karabük',
  'Karaman',
  'Kars',
  'Kastamonu',
  'Kayseri',
  'Kilis',
  'Kırıkkale',
  'Kırklareli',
  'Kırşehir',
  'Kocaeli',
  'Konya',
  'Kütahya',
  'Malatya',
  'Manisa',
  'Mardin',
  'Mersin',
  'Muğla',
  'Muş',
  'Nevşehir',
  'Niğde',
  'Ordu',
  'Osmaniye',
  'Rize',
  'Sakarya',
  'Samsun',
  'Şanlıurfa',
  'Siirt',
  'Sinop',
  'Şırnak',
  'Sivas',
  'Tekirdağ',
  'Tokat',
  'Trabzon',
  'Tunceli',
  'Uşak',
  'Van',
  'Yalova',
  'Yozgat',
  'Zonguldak',
] as const;

export const MARMARA = [
  'Balıkesir',
  'Bilecik',
  'Bursa',
  'Çanakkale',
  'Edirne',
  'İstanbul',
  'Kırklareli',
  'Kocaeli',
  'Sakarya',
  'Tekirdağ',
  'Yalova',
];

const BY_FOLDED = new Map(PROVINCES.map((p) => [foldTurkish(p), p]));

/** Finds a province name in free text (address, title). Prefers the last mention ("..., Karesi/Balıkesir"). */
export function detectCity(text: string | null | undefined): string | null {
  if (!text) return null;
  const words = foldTurkish(text)
    .split(/[^a-z]+/)
    .filter(Boolean);
  for (let i = words.length - 1; i >= 0; i--) {
    const hit = BY_FOLDED.get(words[i] ?? '');
    if (hit) return hit;
  }
  return null;
}

/** Region priority from settings: exact city first, then "Marmara", then "Türkiye" (K-9.3). */
export function regionPriority(
  city: string | null,
  priorities: { name: string; priority: number }[],
): number | null {
  const lowest = priorities.reduce((m, p) => Math.max(m, p.priority), 0) || null;
  if (!city) return lowest;
  const f = foldTurkish(city);
  const exact = priorities.find((p) => foldTurkish(p.name) === f);
  if (exact) return exact.priority;
  if (MARMARA.some((m) => foldTurkish(m) === f)) {
    const marmara = priorities.find((p) => foldTurkish(p.name) === 'marmara');
    if (marmara) return marmara.priority;
  }
  return priorities.find((p) => foldTurkish(p.name) === 'turkiye')?.priority ?? lowest;
}
