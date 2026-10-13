import type { SiteSignals } from '../analysis/html.ts';

/** K-8.11: the site features we compare week to week. */
export interface SiteFeatures {
  booking: boolean;
  whatsapp: boolean;
  onlineOrder: boolean;
  chat: boolean;
  contactForm: boolean;
  branches: boolean;
  careers: boolean;
  campaign: boolean;
}

const fold = (s: string) => s.toLocaleLowerCase('tr');

export function siteFeatures(s: SiteSignals): SiteFeatures {
  const text = fold(`${s.title ?? ''} ${s.description ?? ''} ${s.textSample}`);
  return {
    booking: s.booking,
    whatsapp: s.whatsapp,
    onlineOrder: s.onlineOrder,
    chat: s.chatWidget !== null,
    contactForm: s.hasContactForm,
    branches: s.branches,
    careers: /kariyer|iş ilan|eleman alı|insan kaynakları|ekibimize katıl/.test(text),
    campaign: /kampanya|indirim|fırsat|yeni açıl|açılış/.test(text),
  };
}

export interface SiteChange {
  kind: 'site_change' | 'job_posting' | 'campaign' | 'growth';
  fingerprint: string;
  description: string;
}

const LABEL: Record<keyof SiteFeatures, [string, string, SiteChange['kind']]> = {
  booking: ['Siteye online randevu eklendi', 'Siteden online randevu kaldırıldı', 'site_change'],
  whatsapp: [
    'Siteye WhatsApp bağlantısı eklendi',
    'Siteden WhatsApp bağlantısı kaldırıldı',
    'site_change',
  ],
  onlineOrder: [
    'Siteye online sipariş eklendi',
    'Siteden online sipariş kaldırıldı',
    'site_change',
  ],
  chat: ['Siteye canlı sohbet eklendi', 'Siteden canlı sohbet kaldırıldı', 'site_change'],
  contactForm: [
    'Siteye iletişim formu eklendi',
    'Siteden iletişim formu kaldırıldı',
    'site_change',
  ],
  branches: ['Sitede yeni şube/şubeler görünüyor', 'Sitede şube bilgisi kalktı', 'growth'],
  careers: ['Sitede iş ilanı / eleman arayışı var', 'Sitedeki iş ilanı kalktı', 'job_posting'],
  campaign: [
    'Sitede yeni kampanya / açılış duyurusu var',
    'Sitedeki kampanya duyurusu kalktı',
    'campaign',
  ],
};

/** Changes between two snapshots; only additions of growth-type features and any channel change count. */
export function diffSiteFeatures(
  prev: SiteFeatures | null,
  cur: SiteFeatures,
  period: string,
): SiteChange[] {
  if (!prev) return [];
  const out: SiteChange[] = [];
  for (const key of Object.keys(LABEL) as (keyof SiteFeatures)[]) {
    if (prev[key] === cur[key]) continue;
    const [added, removed, kind] = LABEL[key];
    // A disappearing campaign or job ad is not news; the rest is.
    if (!cur[key] && (key === 'campaign' || key === 'careers' || key === 'branches')) continue;
    out.push({
      kind,
      fingerprint: `${key}${cur[key] ? '+' : '-'}:${period}`,
      description: cur[key] ? added : removed,
    });
  }
  return out;
}
