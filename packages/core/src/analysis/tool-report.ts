import type { SiteSignals } from './html.ts';
import type { PageSpeedResult } from './pagespeed.ts';

/** K-12.3 analysis tool report: built from checks and the (public-data) findings; no extra model call. */
export interface ToolReport {
  business: string;
  website: string | null;
  speed: { mobile: number | null; desktop: number | null; verdict: string };
  channels: { label: string; present: boolean }[];
  reviews: string;
  suggestions: string[];
  strongest: string | null;
}

export interface ToolReportInput {
  business: string;
  site: SiteSignals | null;
  mobile: PageSpeedResult | null;
  desktop: PageSpeedResult | null;
  findings: string[];
  strongest: string | null;
}

function speedVerdict(mobile: number | null, hasSite: boolean): string {
  if (!hasSite)
    return 'Çalışan bir web siteniz bulunamadı; müşterileriniz sizi aradığında yalnızca harita ve sosyal medya kayıtlarınızı görüyor.';
  if (mobile === null) return 'Mobil hız ölçülemedi.';
  if (mobile >= 90) return 'Siteniz telefonda hızlı açılıyor; bu iyi bir başlangıç.';
  if (mobile >= 50)
    return 'Siteniz telefonda orta hızda açılıyor; birkaç saniyelik gecikme ziyaretçi kaybettirebilir.';
  return 'Siteniz telefonda yavaş açılıyor; ziyaretçilerin önemli bir kısmı sayfa açılmadan çıkıyor olabilir.';
}

/** Rule-based suggestions, used after (and de-duplicated against) the analysis findings. */
function ruleSuggestions(i: ToolReportInput): string[] {
  const s = i.site;
  const out: string[] = [];
  if (!s) {
    out.push(
      'Tek sayfalık, telefonda hızlı açılan bir site; adres, çalışma saatleri ve tek tıkla arama/WhatsApp ile başlayın.',
    );
    out.push(
      'Google İşletme Profilinizi eksiksiz doldurun: saatler, fotoğraflar, hizmetler ve site linki.',
    );
  }
  if (s && !s.whatsapp)
    out.push(
      'Sitenize tek tıkla WhatsApp butonu ekleyin; mesaj atmak, aramaktan çok daha kolay geliyor.',
    );
  if (s && !s.booking)
    out.push('Online randevu/talep formu ekleyin; mesai dışında gelen talepler kaybolmasın.');
  if (s && !s.chatWidget)
    out.push(
      'Gece ve hafta sonu gelen sorulara anında cevap veren bir mesaj asistanı, sabaha kalan müşteriyi kurtarır.',
    );
  if (i.mobile?.performance != null && i.mobile.performance < 50)
    out.push(
      'Görselleri sıkıştırıp gereksiz eklentileri kaldırarak mobil hızı 50 puanın üstüne çıkarın.',
    );
  if (s && !s.https)
    out.push('Sitenizi https ile açın; tarayıcılar güvenli olmayan siteleri uyarıyla gösteriyor.');
  if (s && !s.hasContactForm)
    out.push('Kısa bir iletişim formu ekleyin ve gelen her talebe aynı gün dönün.');
  out.push(
    'Gelen her mesaja ilk 5 dakika içinde dönmeyi hedefleyin; ilk dönen işletme çoğu zaman işi alır.',
  );
  return out;
}

export function buildToolReport(i: ToolReportInput): ToolReport {
  const s = i.site;
  const mobile = i.mobile?.performance ?? null;
  const desktop = i.desktop?.performance ?? null;
  const seen = new Set<string>();
  const suggestions = [...i.findings, ...ruleSuggestions(i)].filter((x) => {
    const k = x.trim().toLocaleLowerCase('tr');
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return {
    business: i.business,
    website: s?.url ?? null,
    speed: { mobile, desktop, verdict: speedVerdict(mobile, Boolean(s)) },
    channels: [
      { label: 'WhatsApp bağlantısı', present: Boolean(s?.whatsapp) },
      { label: 'Online randevu / sipariş', present: Boolean(s?.booking || s?.onlineOrder) },
      { label: 'Canlı sohbet / mesaj asistanı', present: Boolean(s?.chatWidget) },
      { label: 'İletişim formu', present: Boolean(s?.hasContactForm) },
      { label: 'Instagram bağlantısı', present: Boolean(s?.socials.instagram) },
    ],
    reviews:
      'Google yorumları, yeni müşterinin ilk baktığı yerdir. Her yoruma (özellikle olumsuzlara) 24 saat içinde kibar ve somut bir cevap verin; memnun müşterilerden işlem sonrası kısa bir linkle yorum isteyin.',
    suggestions: suggestions.slice(0, 3),
    strongest: i.strongest,
  };
}

/** Plain-text email version (the unsubscribe footer is added by the send path). */
export function toolReportEmail(
  r: ToolReport,
  reportUrl: string,
): { subject: string; text: string } {
  const pct = (n: number | null) => (n === null ? '—' : `${n}/100`);
  return {
    subject: `${r.business} için dijital analiz raporunuz`,
    text: [
      'Merhaba,',
      '',
      `${r.business} için istediğiniz analiz hazır. Özet:`,
      '',
      `Hız: mobil ${pct(r.speed.mobile)}, masaüstü ${pct(r.speed.desktop)}. ${r.speed.verdict}`,
      '',
      'İletişim kanalları:',
      ...r.channels.map((c) => `• ${c.label}: ${c.present ? 'var' : 'yok'}`),
      '',
      `Yorum yönetimi: ${r.reviews}`,
      '',
      'Üç somut öneri:',
      ...r.suggestions.map((s, n) => `${n + 1}. ${s}`),
      '',
      `Raporun tamamı: ${reportUrl}`,
      '',
      'Bu adımların çoğunu sizin için kurabiliriz. İsterseniz bu maile cevap verin, 15 dakikalık bir görüşmede birlikte bakalım.',
      '',
      'AJNA Digital',
    ].join('\n'),
  };
}
