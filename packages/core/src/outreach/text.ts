/** Words as a reader counts them (numbers and Turkish letters included). */
export function wordCount(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’./-]*/gu) ?? []).length;
}

/** K-10.15: a cold email must not exceed the configured word limit (default 80). Signature/footer excluded. */
export function checkColdEmail(body: string, maxWords: number): { ok: boolean; words: number } {
  const words = wordCount(body);
  return { ok: words <= maxWords, words };
}

export const UNSUBSCRIBE_MARKER = 'Bu tür e-postaları almak istemiyorsanız:';

/** K-10.13: every email carries an unsubscribe link. */
export function withUnsubscribeFooter(body: string, url: string): string {
  return `${body.trimEnd()}\n\n--\n${UNSUBSCRIBE_MARKER} ${url}`;
}

export function hasUnsubscribeLink(body: string, url: string): boolean {
  return body.includes(url);
}

/** K-10.2: one-click WhatsApp link with the message prefilled. */
export function whatsappLink(phoneE164: string, text: string): string {
  return `https://wa.me/${phoneE164.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
}

export function instagramProfileLink(handle: string): string {
  return `https://instagram.com/${handle.replace(/^@/, '')}`;
}

/** K-10.5: X intent link (no API). */
export function xIntentLink(text: string): string {
  return `https://x.com/intent/post?text=${encodeURIComponent(text)}`;
}

/** Replaces {{key}} placeholders. Personal fields are filled by code, never written by a free-tier model. */
export function fillTemplate(
  template: string,
  values: Record<string, string | null | undefined>,
): string {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => values[k]?.trim() || '');
}

/** Removes banned phrases (settings) case-insensitively; returns the phrases found. */
export function findBannedPhrases(text: string, banned: string[]): string[] {
  const lower = text.toLocaleLowerCase('tr');
  return banned.filter((p) => p.trim() && lower.includes(p.toLocaleLowerCase('tr')));
}
