import { instagramProfileLink, whatsappLink, xIntentLink } from '@papi/core';
import type { Channel, OneClickItem, ReplyClass } from '@/data/types';

export const CHANNEL_LABEL: Record<Channel, string> = {
  email: 'E-posta',
  whatsapp: 'WhatsApp',
  instagram_dm: 'Instagram DM',
  linkedin: 'LinkedIn',
  x: 'X',
  phone_call: 'Telefon',
  visit: 'Ziyaret',
  demo: 'Demo',
};

export const REPLY_LABEL: Record<ReplyClass, string> = {
  interested: 'İlgileniyor',
  question: 'Soru',
  later: 'Sonra',
  no: 'Hayır',
  do_not_contact: 'Yazmayın',
  auto_reply: 'Otomatik yanıt',
  unknown: 'Cevap',
};

export function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Istanbul',
  }).format(new Date(iso));
}

/** Where the "open" button of a one-click item leads (K-10.16); null when there is nothing to open. */
export function openLink(t: OneClickItem): { label: string; href: string } | null {
  const body = t.body ?? '';
  if (t.channel === 'whatsapp' && t.recipient)
    return { label: "WhatsApp'ta aç", href: whatsappLink(t.recipient, body) };
  if (t.channel === 'instagram_dm' && t.recipient)
    return { label: 'Profili aç', href: instagramProfileLink(t.recipient) };
  if (t.channel === 'linkedin' && t.recipient) return { label: 'Profili aç', href: t.recipient };
  if (t.channel === 'x') return { label: "X'te paylaş", href: xIntentLink(body) };
  if (t.channel === 'phone_call' && t.recipient)
    return { label: `Ara: +${t.recipient}`, href: `tel:+${t.recipient}` };
  return null;
}

export function doneLabel(channel: Channel): string {
  return channel === 'phone_call' ? 'Aradım' : channel === 'visit' ? 'Gittim' : 'Gönderdim';
}
