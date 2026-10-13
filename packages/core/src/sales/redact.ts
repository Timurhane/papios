/**
 * K-4.9: strip personal data from replies and meeting notes before they may reach a free-tier model.
 * What remains (the business need) is classified "internal". Conservative by design: when unsure, redact.
 */
export interface RedactOptions {
  /** Known person names for this company (CRM contacts). */
  names?: string[];
}

export interface Redacted {
  text: string;
  /** Number of replacements made (for the audit log). */
  replaced: number;
}

const EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,24}/g;
const IBAN = /\bTR\s?\d{2}(?:\s?[0-9A-Z]{4}){5}\s?[0-9A-Z]{2}\b/gi;
// TR phones: +90 / 0 prefix, 10 digits with optional separators; also bare 10–13 digit runs
const PHONE = /(?:\+?\s?90[\s.-]?)?\(?0?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{2}[\s.-]?\d{2}\b/g;
const TCKN = /\b[1-9]\d{10}\b/g;
const UPPER = 'A-ZÇĞİÖŞÜ';
const LOWER = 'a-zçğıöşü';
const NAME_WORD = `[${UPPER}][${LOWER}]+`;
// "Ahmet Bey", "Ayşe Hanım", "Ahmet Yılmaz Bey"
const HONORIFIC = new RegExp(
  `\\b${NAME_WORD}(?:\\s+${NAME_WORD})?\\s+(Bey|Hanım|Hanim|Bay|Bayan)\\b`,
  'g',
);
// "Dr. Ayşe Yılmaz", "Uzm. Dr. Ayşe", "Av. Mehmet Kaya", "Sayın Ahmet Yılmaz"
const TITLED = new RegExp(
  `\\b(?:(?:Prof|Doç|Uzm|Op|Dr|Av|Müh|Dt|Psk|Ecz)\\.\\s*)+${NAME_WORD}(?:\\s+${NAME_WORD})?`,
  'g',
);
const SAYIN = new RegExp(`\\bSayın\\s+${NAME_WORD}(?:\\s+${NAME_WORD})?`, 'g');
// a sign-off line starts the signature block; everything after it is dropped
const SIGN_OFF =
  /^\s*(?:saygılarımla|saygılarımızla|iyi çalışmalar|teşekkürler|teşekkür ederim|kolay gelsin|selamlar|sevgiler|best regards|regards|--)\s*[,.!]?\s*$/im;

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function redactPersonal(input: string, opts: RedactOptions = {}): Redacted {
  let replaced = 0;
  const sub = (text: string, re: RegExp, token: string) =>
    text.replace(re, (m, ...groups: unknown[]) => {
      replaced++;
      const honor =
        typeof groups[0] === 'string' && /^(Bey|Hanım|Hanim|Bay|Bayan)$/.test(groups[0]);
      return honor ? `${token} ${groups[0]}` : token;
    });

  let text = input;
  const cut = SIGN_OFF.exec(text);
  if (cut) {
    text = text.slice(0, cut.index).trimEnd();
    replaced++;
  }
  text = sub(text, EMAIL, '[e-posta]');
  text = sub(text, IBAN, '[IBAN]');
  text = sub(text, TCKN, '[kimlik no]');
  text = sub(text, PHONE, '[telefon]');
  text = sub(text, TITLED, '[kişi]');
  text = sub(text, SAYIN, 'Sayın [kişi]');
  text = sub(text, HONORIFIC, '[kişi]');

  const words = new Set<string>();
  for (const n of opts.names ?? []) {
    const full = n.trim();
    if (full.length >= 3) words.add(full);
    for (const w of full.split(/\s+/)) if (w.length >= 3 && !w.endsWith('.')) words.add(w);
  }
  // longest first so a full name is replaced before its parts
  for (const w of [...words].sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`(?<![${UPPER}${LOWER}])${escape(w)}(?![${UPPER}${LOWER}])`, 'giu');
    text = sub(text, re, '[kişi]');
  }
  return { text: text.replace(/(\[kişi\])(\s+\[kişi\])+/g, '$1'), replaced };
}
