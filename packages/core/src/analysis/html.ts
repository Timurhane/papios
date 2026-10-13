import { normalizeEmail, normalizePhone } from '../crm/normalize.ts';

export const MAX_HTML_BYTES = 200_000;

export interface SiteSignals {
  url: string;
  https: boolean;
  title: string | null;
  description: string | null;
  lang: string | null;
  generator: string | null;
  hasContactForm: boolean;
  whatsapp: boolean;
  booking: boolean;
  onlineOrder: boolean;
  chatWidget: string | null;
  socials: Partial<
    Record<'instagram' | 'facebook' | 'linkedin' | 'youtube' | 'tiktok' | 'x', string>
  >;
  emails: string[];
  phones: string[];
  contactPageUrl: string | null;
  copyrightYear: number | null;
  branches: boolean;
  decisionMakerHints: string[];
  textSample: string;
}

const CHAT_WIDGETS: [string, RegExp][] = [
  ['tawk', /tawk\.to/i],
  ['tidio', /tidio/i],
  ['intercom', /intercom/i],
  ['crisp', /crisp\.chat/i],
  ['zendesk', /zdassets|zendesk/i],
  ['jivo', /jivosite|jivochat/i],
  ['livechat', /livechatinc/i],
  ['whatsapp-widget', /whatsapp-widget|wa-widget|elfsight.*whatsapp/i],
];

const SOCIAL_PATTERNS: [keyof SiteSignals['socials'], RegExp][] = [
  ['instagram', /https?:\/\/(?:www\.)?instagram\.com\/([a-z0-9._]+)/i],
  ['facebook', /https?:\/\/(?:www\.|tr-tr\.)?facebook\.com\/[a-z0-9._-]+/i],
  ['linkedin', /https?:\/\/(?:[a-z]+\.)?linkedin\.com\/(?:company|in)\/[a-z0-9._-]+/i],
  ['youtube', /https?:\/\/(?:www\.)?youtube\.com\/[a-z0-9@._/-]+/i],
  ['tiktok', /https?:\/\/(?:www\.)?tiktok\.com\/@[a-z0-9._]+/i],
  ['x', /https?:\/\/(?:www\.)?(?:twitter|x)\.com\/[a-z0-9_]+/i],
];

const BOOKING =
  /(online\s*randevu|randevu\s*al|randevu\s*olu[şs]tur|rezervasyon\s*yap|book\s*now|appointment|calendly\.com|randevu\.(?:com|net)|doktortakvimi)/i;
const ORDER =
  /(sepete\s*ekle|online\s*sipari[şs]|add\s*to\s*cart|sipari[şs]\s*ver|woocommerce|shopify|ticimax|ideasoft|ikas)/i;
const CONTACT_LINK =
  /href=["']([^"']*(?:iletisim|ileti%C5%9Fim|contact|bize-ulasin|bize-ula%C5%9F%C4%B1n)[^"']*)["']/i;
const BRANCHES = /([şs]ubelerimiz|[şs]ubeler|branches|[0-9]{1,3}\s{0,3}[şs]ube)/i;
const DECISION =
  /((?:Dr\.|Uzm\.|Op\.|Av\.|Mimar|Mühendis)\s{0,3}(?:Dr\.\s{0,3})?[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,30}(?:\s{1,3}[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,30}){1,2})|((?:Kurucu|Genel Müdür|Sahibi|CEO)[\s:,-]{1,5}[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,30}\s{1,3}[A-ZÇĞİÖŞÜ][a-zçğıöşü]{1,30})/g;

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)));
}

function meta(html: string, name: string): string | null {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*>`, 'i');
  const tag = re.exec(html)?.[0];
  const content = tag ? /content=["']([^"']*)["']/i.exec(tag)?.[1] : undefined;
  return content ? decodeEntities(content).trim() || null : null;
}

/** Rule-based checks on a page's HTML (K-9.1: code first, model second). */
export function extractSignals(htmlInput: string, pageUrl: string): SiteSignals {
  const html = htmlInput.length > MAX_HTML_BYTES ? htmlInput.slice(0, MAX_HTML_BYTES) : htmlInput;
  const lower = html.toLowerCase();
  const text = decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();

  const socials: SiteSignals['socials'] = {};
  for (const [key, re] of SOCIAL_PATTERNS) {
    const m = re.exec(html);
    if (m && !/sharer|share\?|intent\//i.test(m[0]))
      socials[key] = key === 'instagram' ? (m[1] ?? m[0]).toLowerCase() : m[0];
  }

  const emails = new Set<string>();
  for (const m of html.matchAll(/mailto:([^"'?\s>]+)/gi)) {
    const e = normalizeEmail(decodeURIComponent(m[1] ?? ''));
    if (e) emails.add(e);
  }
  // Bounded quantifiers keep matching linear on huge pages (Workers CPU budget).
  for (const m of text.matchAll(
    /[a-z0-9._%+-]{1,64}@[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63}){0,4}\.[a-z]{2,24}/gi,
  )) {
    const e = normalizeEmail(m[0]);
    if (e && !/\.(png|jpe?g|gif|webp|svg)$/.test(e)) emails.add(e);
  }

  const phones = new Set<string>();
  for (const m of html.matchAll(/(?:wa\.me\/|api\.whatsapp\.com\/send\?phone=)\+?(\d{10,15})/gi)) {
    const p = normalizePhone(m[1] ?? '');
    if (p) phones.add(p);
  }
  for (const m of html.matchAll(/tel:([+0-9()\s-]{7,24})/gi)) {
    const p = normalizePhone(m[1] ?? '');
    if (p) phones.add(p);
  }
  for (const m of text.matchAll(
    /(?:\+90|0)\s{0,2}\(?[2-5]\d{2}\)?[\s.-]{0,3}\d{3}[\s.-]{0,3}\d{2}[\s.-]{0,3}\d{2}/g,
  )) {
    const p = normalizePhone(m[0]);
    if (p) phones.add(p);
  }

  const contactHref = CONTACT_LINK.exec(html)?.[1];
  let contactPageUrl: string | null = null;
  if (contactHref && !contactHref.startsWith('#') && !contactHref.startsWith('mailto:')) {
    try {
      contactPageUrl = new URL(contactHref, pageUrl).toString();
    } catch {
      contactPageUrl = null;
    }
  }

  const years = [...text.matchAll(/(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?(\d{4})/gi)].map(
    (m) => Number(m[1]),
  );
  const decisionMakerHints = [
    ...new Set([...text.matchAll(DECISION)].map((m) => m[0].trim())),
  ].slice(0, 5);

  return {
    url: pageUrl,
    https: pageUrl.startsWith('https://'),
    title: decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '').trim() || null,
    description: meta(html, 'description') ?? meta(html, 'og:description'),
    lang: /<html[^>]+lang=["']([a-z-]+)["']/i.exec(html)?.[1]?.toLowerCase() ?? null,
    generator:
      meta(html, 'generator') ??
      (lower.includes('wp-content') ? 'WordPress' : lower.includes('wix.com') ? 'Wix' : null),
    hasContactForm: hasContactForm(html),
    whatsapp: /(wa\.me\/|api\.whatsapp\.com|whatsapp:\/\/|web\.whatsapp\.com\/send)/i.test(html),
    booking: BOOKING.test(text) || BOOKING.test(html),
    onlineOrder: ORDER.test(text) || ORDER.test(html),
    chatWidget: CHAT_WIDGETS.find(([, re]) => re.test(html))?.[0] ?? null,
    socials,
    emails: [...emails].slice(0, 10),
    phones: [...phones].slice(0, 10),
    contactPageUrl,
    copyrightYear: years.length ? Math.max(...years) : null,
    branches: BRANCHES.test(text),
    decisionMakerHints,
    textSample: text.slice(0, 2500),
  };
}

/** A form containing an email/tel input or a textarea, checked form by form (no cross-form backtracking). */
function hasContactForm(html: string): boolean {
  const lower = html.toLowerCase();
  let from = 0;
  for (let guard = 0; guard < 50; guard++) {
    const start = lower.indexOf('<form', from);
    if (start === -1) return false;
    const end = lower.indexOf('</form>', start);
    const body = lower.slice(start, end === -1 ? undefined : end);
    if (/type=["'](?:email|tel)["']|<textarea/.test(body)) return true;
    if (end === -1) return false;
    from = end + 7;
  }
  return false;
}

/** Merges signals from the home page and the contact page. */
export function mergeSignals(home: SiteSignals, extra: SiteSignals | null): SiteSignals {
  if (!extra) return home;
  return {
    ...home,
    hasContactForm: home.hasContactForm || extra.hasContactForm,
    whatsapp: home.whatsapp || extra.whatsapp,
    booking: home.booking || extra.booking,
    onlineOrder: home.onlineOrder || extra.onlineOrder,
    chatWidget: home.chatWidget ?? extra.chatWidget,
    socials: { ...extra.socials, ...home.socials },
    emails: [...new Set([...home.emails, ...extra.emails])].slice(0, 10),
    phones: [...new Set([...home.phones, ...extra.phones])].slice(0, 10),
    branches: home.branches || extra.branches,
    decisionMakerHints: [
      ...new Set([...home.decisionMakerHints, ...extra.decisionMakerHints]),
    ].slice(0, 5),
    textSample: `${home.textSample} ${extra.textSample}`.slice(0, 3500),
  };
}
