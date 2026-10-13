/** Small RFC 4180 CSV parser with delimiter detection (comma, semicolon, tab). */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^\uFEFF/, '');
  const firstLine = src.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [';', '\t', ','].reduce(
    (best, d) => (count(firstLine, d) > count(firstLine, best) ? d : best),
    ',',
  );
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function count(s: string, ch: string) {
  return s.split(ch).length - 1;
}

export interface ImportRow {
  name: string;
  website?: string;
  phone?: string;
  email?: string;
  city?: string;
  district?: string;
  address?: string;
  instagram?: string;
  sector?: string;
}

const HEADER_ALIASES: Record<keyof ImportRow, string[]> = {
  name: [
    'ad',
    'adi',
    'isim',
    'firma',
    'firma adi',
    'isletme',
    'isletme adi',
    'unvan',
    'name',
    'company',
  ],
  website: ['web', 'site', 'web sitesi', 'website', 'url', 'internet sitesi'],
  phone: ['telefon', 'tel', 'gsm', 'cep', 'phone', 'telefon no'],
  email: ['e-posta', 'eposta', 'email', 'e-mail', 'mail'],
  city: ['sehir', 'il', 'city'],
  district: ['ilce', 'district'],
  address: ['adres', 'address'],
  instagram: ['instagram', 'ig'],
  sector: ['sektor', 'kategori', 'sector', 'category'],
};

const FOLD: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u', İ: 'i' };
const foldHeader = (h: string) =>
  h
    .trim()
    .toLocaleLowerCase('tr')
    .replace(/[çğıöşüİ]/g, (c) => FOLD[c] ?? c);

/** Maps a CSV with Turkish or English headers to ImportRows; rows without a name are dropped. */
export function csvToImportRows(text: string): { rows: ImportRow[]; unknownHeaders: string[] } {
  const [header, ...body] = parseCsv(text);
  if (!header) return { rows: [], unknownHeaders: [] };
  const map = header.map((h) => {
    const f = foldHeader(h);
    return (
      (Object.keys(HEADER_ALIASES) as (keyof ImportRow)[]).find((k) =>
        HEADER_ALIASES[k].includes(f),
      ) ?? null
    );
  });
  const unknownHeaders = header.filter((_, i) => map[i] === null);
  const rows: ImportRow[] = [];
  for (const r of body) {
    const row: Partial<ImportRow> = {};
    map.forEach((key, i) => {
      const v = r[i]?.trim();
      if (key && v) row[key] = v;
    });
    if (row.name) rows.push(row as ImportRow);
  }
  return { rows, unknownHeaders };
}
