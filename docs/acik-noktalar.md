# Açık noktalar ve teslim listesi (K-19.1)

Kod tarafı Faz 0–7 tamam. Aşağıdakiler Timurhan'ın kararını ya da masaüstü kurulum oturumunu bekliyor.

## Kararlar

| #   | Konu                                         | Etkisi                                             |
| --- | -------------------------------------------- | -------------------------------------------------- |
| A-1 | Mail altyapısı: Natro SMTP/IMAP vs Gmail API | Ulaşma mailleri, gelen kutusu, analiz raporu maili |
| A-3 | Sesli cevap (TTS) sağlayıcısı                | Telegram'da isteğe bağlı sesli cevap               |
| A-6 | KDV dahil/hariç varsayılanı                  | Her teklifte zaten soruluyor; varsayılan kolaylık  |

## Masaüstü kurulum oturumu (sırayla)

`docs/kurulum.md` → "Sıra" ve `docs/setup/accounts.md` (özellikle §11–§14):

- Tüm hesap ve anahtarlar, Worker ve panel yayını, Telegram webhook
- Turnstile (demo, kurulum formu, analiz aracı), Google Takvim
- Yedek anahtarı (age) + `SUPABASE_DB_URL`, ilk yedek ve geri yükleme testi
- `SUPABASE_ACCESS_TOKEN`'ı dar yetkiyle yenileme (V-23)
- Gemini Live'ın ücretsiz katmanda açık olduğu ve `live_voice.model` adının kontrolü
- Kota sayfalarından gerçek limitlerin teyidi (V-25)
- Her fazın canlı kabulü (`docs/kurulum.md` → "Kontrol listesi")

## Uzman kontrolü gerekenler

- Analiz aracı aydınlatma metni ve açık rıza metni: hukukçu (K-17.7)
- Ticari elektronik ileti / İYS yükümlülükleri: uzman görüşü
- Fatura ve KDV uygulaması: mali müşavir

## Varsayımlar

Tümü `docs/decisions.md` → "Varsayımlar" (V-1 … V-86). Onaylanan varsayım karar maddesine dönüşür.

## Rehberler

- Kurulum / yeniden kurulum: `docs/kurulum.md`
- Yedekten geri yükleme: `docs/yedekten-geri-yukleme.md`
- Yeni entegrasyon: `docs/yeni-entegrasyon.md`
- Yeni playbook: `docs/yeni-playbook.md`
- Claude'a geçiş: `docs/switch-to-claude.md`
- Places ve WhatsApp Business'ı açma: `docs/enable-places-and-whatsapp.md`
- Analiz aracını siteye ekleme: `docs/analiz-araci-ekleme.md`
- Ücretsiz limitler: `docs/free-tier-limits.md`
