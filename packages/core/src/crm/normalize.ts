const TR_FOLD: Record<string, string> = {
  ç: 'c',
  ğ: 'g',
  ı: 'i',
  i: 'i',
  ö: 'o',
  ş: 's',
  ü: 'u',
  â: 'a',
  î: 'i',
  û: 'u',
};

/** Lowercases with Turkish rules and folds Turkish letters to ASCII. */
export function foldTurkish(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/[çğıiöşüâîû]/g, (c) => TR_FOLD[c] ?? c)
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
}

const LEGAL_SUFFIXES = [
  'limited sirketi',
  'ltd sti',
  'ltd',
  'sti',
  'anonim sirketi',
  'a s',
  'as',
  'san ve tic',
  'san tic',
  'sanayi ve ticaret',
  'tic',
  'insaat',
];

/** Normalized company name for duplicate detection (K-8.10). */
export function normalizeName(name: string): string {
  let s = foldTurkish(name)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const suffix of LEGAL_SUFFIXES) {
      if (s.endsWith(` ${suffix}`)) {
        s = s.slice(0, -suffix.length - 1).trim();
        changed = true;
      }
    }
  }
  return s.replace(/\s+/g, ' ');
}

/** Registrable-ish domain from a URL or host: lowercased, without scheme, www, port and path. */
export function normalizeDomain(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let host: string;
  try {
    host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
  } catch {
    return null;
  }
  host = host
    .toLowerCase()
    .replace(/^www\d?\./, '')
    .replace(/\.$/, '');
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) ? host : null;
}

/** Turkish phone numbers to E.164 digits without '+', e.g. 905321234567. Null if not plausible. */
export function normalizePhone(input: string): string | null {
  let d = input.replace(/\D/g, '');
  if (d.startsWith('0090')) d = d.slice(2);
  if (d.length === 11 && d.startsWith('0')) d = `90${d.slice(1)}`;
  if (d.length === 10 && /^[2-5]/.test(d)) d = `90${d}`;
  if (d.length === 12 && d.startsWith('90')) return d;
  if (d.length >= 10 && d.length <= 15 && !d.startsWith('0') && !d.startsWith('90')) return d;
  return null;
}

export function normalizeEmail(input: string): string | null {
  const e = input.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/.test(e) ? e : null;
}

const SOCIAL_HOSTS = [
  'instagram.com',
  'facebook.com',
  'linkedin.com',
  'twitter.com',
  'x.com',
  'youtube.com',
  'tiktok.com',
  'wa.me',
  'whatsapp.com',
];
const MAPS = /(^|\.)(google\.[a-z.]+|goo\.gl|maps\.app\.goo\.gl)$/;

export type LinkKind =
  | { kind: 'website'; url: string; domain: string }
  | { kind: 'instagram'; handle: string }
  | { kind: 'maps'; url: string; name: string | null }
  | { kind: 'linkedin'; url: string }
  | { kind: 'unknown'; url: string };

/** Classifies a link sent from Telegram (K-8.6). */
export function detectLink(input: string): LinkKind | null {
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(input.trim()) ? input.trim() : `https://${input.trim()}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  if (host === 'instagram.com' || host.endsWith('.instagram.com')) {
    const handle = url.pathname.split('/').filter(Boolean)[0]?.toLowerCase();
    if (!handle || ['p', 'reel', 'stories', 'explore'].includes(handle))
      return { kind: 'unknown', url: url.toString() };
    return { kind: 'instagram', handle: handle.replace(/^@/, '') };
  }
  if (MAPS.test(host) && (url.pathname.includes('/maps') || host.includes('goo.gl'))) {
    const m = /\/maps\/place\/([^/@]+)/.exec(url.pathname);
    const name = m?.[1] ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : null;
    return { kind: 'maps', url: url.toString(), name };
  }
  if (host.endsWith('linkedin.com')) return { kind: 'linkedin', url: url.toString() };
  if (SOCIAL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`)))
    return { kind: 'unknown', url: url.toString() };
  const domain = normalizeDomain(url.hostname);
  if (!domain) return null;
  return { kind: 'website', url: `${url.protocol}//${url.host}${url.pathname}`, domain };
}

/** Keys used to find an existing company before inserting (K-8.10). */
export interface DedupeKeys {
  domain: string | null;
  phone: string | null;
  instagram: string | null;
  nameNorm: string;
  city: string | null;
}

export function dedupeKeys(c: {
  name: string;
  website?: string | null;
  phone?: string | null;
  instagram?: string | null;
  city?: string | null;
}): DedupeKeys {
  return {
    domain: c.website ? normalizeDomain(c.website) : null,
    phone: c.phone ? normalizePhone(c.phone) : null,
    instagram: c.instagram ? c.instagram.trim().toLowerCase().replace(/^@/, '') || null : null,
    nameNorm: normalizeName(c.name),
    city: c.city ? foldTurkish(c.city).trim() : null,
  };
}
