/**
 * K-6.8: repeated corrections become a suggested rule. Rule-based grouping (no model): instructions are
 * normalized to word sets and grouped by overlap; a group of `minCount` or more becomes a suggestion.
 */
const STOP = new Set([
  've',
  'bir',
  'bu',
  'da',
  'de',
  'çok',
  'daha',
  'gibi',
  'için',
  'ile',
  'olsun',
  'yap',
  'yaz',
  'lütfen',
  'biraz',
  'şu',
  'o',
]);

function words(s: string): Set<string> {
  return new Set(
    s
      .toLocaleLowerCase('tr')
      .replace(/[^\p{L}\d\s]/gu, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w))
      .map((w) => w.slice(0, 6)), // crude Turkish stemming: suffixes vary, stems stay
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export interface RuleSuggestion {
  rule: string;
  count: number;
  examples: string[];
  fingerprint: string;
}

export function suggestRules(
  instructions: string[],
  minCount = 3,
  threshold = 0.4,
): RuleSuggestion[] {
  const groups: { rep: Set<string>; items: string[] }[] = [];
  for (const raw of instructions) {
    const text = raw.trim();
    if (!text) continue;
    const w = words(text);
    if (w.size === 0) continue;
    const g = groups.find((x) => jaccard(x.rep, w) >= threshold);
    if (g) g.items.push(text);
    else groups.push({ rep: w, items: [text] });
  }
  return groups
    .filter((g) => g.items.length >= minCount)
    .map((g) => {
      const shortest = [...g.items].sort((a, b) => a.length - b.length)[0] ?? '';
      return {
        rule: shortest,
        count: g.items.length,
        examples: g.items.slice(0, 5),
        fingerprint: `rule:${[...g.rep].sort().join('-')}`,
      };
    })
    .sort((a, b) => b.count - a.count);
}

export interface StepStat {
  playbook: string;
  position: number;
  angle: string;
  sent: number;
  replies: number;
}

export interface PlaybookSuggestion {
  title: string;
  reason: string;
  fingerprint: string;
}

/** K-11.6: steps that keep getting no answer after enough sends are flagged (suggestion only). */
export function suggestPlaybookChanges(stats: StepStat[], minSent = 20): PlaybookSuggestion[] {
  const out: PlaybookSuggestion[] = [];
  for (const s of stats) {
    if (s.sent < minSent) continue;
    if (s.replies === 0)
      out.push({
        title: `${s.playbook} ${s.position}. adımı ("${s.angle}") değiştir ya da çıkar`,
        reason: `${s.sent} gönderimde hiç cevap yok.`,
        fingerprint: `pb:${s.playbook}:${s.position}:zero:${Math.floor(s.sent / 20)}`,
      });
  }
  return out;
}
