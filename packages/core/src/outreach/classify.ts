import { foldTurkish } from '../crm/normalize.ts';

export type ReplyClass =
  'interested' | 'question' | 'later' | 'no' | 'do_not_contact' | 'auto_reply' | 'unknown';

/**
 * K-13.4 reply classes. Replies are personal data, so they are never sent to a free-tier model (K-4.7):
 * classification is rule based. Order matters: the strongest signal wins. Patterns match word starts
 * (\b before, none after) so Turkish suffixes still match: çıkar → çıkarın.
 */
const RULES: [ReplyClass, RegExp][] = [
  [
    'do_not_contact',
    /\b(yazmayin|yazmayiniz|rahatsiz etmeyin|rahatsiz etmeyiniz|listeden (cikar|cik)|aboneligi(mi)? (iptal|sonlandir)|abonelikten cik|mail (atmayin|gondermeyin)|bir daha (yazmayin|mail|ulasmayin|aramayin)|iletisime gecmeyin|unsubscribe|remove me|stop emailing|spam)/,
  ],
  [
    'no',
    /\b(ilgilenmiyoruz|ilgilenmiyorum|ihtiyacimiz yok|ihtiyacim yok|gerek yok|istemiyoruz|tesekkurler ama|uygun degil|hayir tesekkur|calisiyoruz zaten|zaten (bir )?ajans)/,
  ],
  [
    'later',
    /\b(su an (degil|uygun degil|yogunuz)|simdilik (degil|gerek yok)|daha sonra|sonra konusalim|ileride|ilerleyen (gunlerde|donemde|aylarda)|sezon (sonu|sonrasi)|yeni yilda|birkac ay sonra)/,
  ],
  [
    'interested',
    /\b(ilgileniyoruz|ilgileniyorum|ilginc|gorusebiliriz|gorusmek isteriz|gorusmek isterim|gorusmek (uzere|icin)|arayabilirsiniz|arayin|toplanti|fiyat|ucret|teklif|detayli bilgi|bilgi alabilir|demo|deneyebiliriz|uygun (bir )?zaman)/,
  ],
];

const AUTO_SUBJECT =
  /\b(otomatik (yanit|cevap)|out of office|automatic reply|auto.?reply|izindeyim|ofis disindayim|tatildeyim)\b/;

export function classifyReply(input: {
  subject?: string | null;
  body?: string | null;
  headers?: Record<string, string>;
}): ReplyClass {
  const h = Object.fromEntries(
    Object.entries(input.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()]),
  );
  if (
    (h['auto-submitted'] && h['auto-submitted'] !== 'no') ||
    h['x-autoreply'] ||
    h['x-autorespond'] ||
    h['precedence'] === 'auto_reply'
  ) {
    return 'auto_reply';
  }
  const subject = foldTurkish(input.subject ?? '');
  const body = foldTurkish(stripQuoted(input.body ?? ''));
  if (AUTO_SUBJECT.test(subject) || AUTO_SUBJECT.test(body.slice(0, 300))) return 'auto_reply';
  for (const [cls, re] of RULES) if (re.test(body) || re.test(subject)) return cls;
  if (body.includes('?')) return 'question';
  return 'unknown';
}

/** Drops the quoted original ("> ..." lines and everything after "... yazdı:" / "On ... wrote:"). */
export function stripQuoted(body: string): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) continue;
    if (/(tarihinde.*yazdı:|wrote:|-----\s*original message|^--\s*$)/i.test(line)) break;
    out.push(line);
  }
  return out.join('\n').trim();
}
