/** K-14.1: delivery modules. Each lives in its own folder with README, SETUP, TESTS and config.schema.json. */
export type ModuleCode =
  'cevap-asistani' | 'takip-dizisi' | 'randevu-hatirlatma' | 'google-yorum' | 'aylik-rapor';

export type PackageCode = 'refleks' | 'sistem' | 'operasyon' | 'ozel';

export interface DeliveryModule {
  code: ModuleCode;
  name: string;
  summary: string;
  /** Packages that include this module (K-7.3). */
  packages: PackageCode[];
  /** True when a working reference implementation ships with the template (K-14.3). */
  reference: boolean;
  /** Setup steps that become checklist items for the project. */
  setupSteps: string[];
}

export const MODULES: DeliveryModule[] = [
  {
    code: 'cevap-asistani',
    name: 'Cevap asistanı',
    summary:
      'Site, Instagram ve (açılırsa) WhatsApp mesajlarına işletme adına anında cevap; ilgilenen kişiyi kaydeder ve sahibine bildirir.',
    packages: ['refleks', 'sistem', 'operasyon'],
    reference: true,
    setupSteps: [
      'Müşterinin Cloudflare hesabında Worker yayınlandı',
      'Yapay zeka anahtarı müşterinin hesabında secret olarak eklendi (ücretli katman önerildi)',
      'Site sohbet kutusu kodu siteye eklendi',
      'Instagram DM bağlantısı (Meta uygulaması + webhook) kuruldu',
      'Sahip bildirimi (Telegram veya e-posta) test edildi',
    ],
  },
  {
    code: 'takip-dizisi',
    name: 'Takip dizisi',
    summary: 'Cevap vermeyen adaylara belirlenen günlerde kısa, kişisel takip mesajları.',
    packages: ['refleks', 'sistem', 'operasyon'],
    reference: false,
    setupSteps: [
      'Takip günleri ve mesaj şablonları müşteriyle onaylandı',
      'Aday listesi kaynağı (cevap asistanı kayıtları) bağlandı',
    ],
  },
  {
    code: 'randevu-hatirlatma',
    name: 'Randevu ve ödeme hatırlatma',
    summary: 'Randevudan ve ödeme gününden önce müşteriye otomatik hatırlatma.',
    packages: ['sistem', 'operasyon'],
    reference: false,
    setupSteps: [
      'Randevu/ödeme verisinin geldiği program bağlandı',
      'Hatırlatma zamanları ve metinleri onaylandı',
    ],
  },
  {
    code: 'google-yorum',
    name: 'Google yorum toplama ve cevaplama',
    summary: 'Memnun müşteriden yorum isteme, gelen yorumlara işletme tonunda cevap taslağı.',
    packages: ['sistem', 'operasyon'],
    reference: false,
    setupSteps: [
      'Google İşletme profiline erişim (müşterinin hesabı) verildi',
      'Yorum isteme zamanı ve mesajı onaylandı',
    ],
  },
  {
    code: 'aylik-rapor',
    name: 'Aylık performans raporu',
    summary:
      'Her ay gelen mesaj, cevap süresi, yakalanan aday ve randevu sayıları; kişisel veri içermez.',
    packages: ['refleks', 'sistem', 'operasyon'],
    reference: false,
    setupSteps: ['Modüllerin aylık sayıları Papi’ye gönderdiği doğrulandı (metrics token)'],
  },
];

export function modulesFor(pkg: string): DeliveryModule[] {
  return MODULES.filter((m) => (m.packages as string[]).includes(pkg));
}
