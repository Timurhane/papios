# Ücretsiz katman limitleri

> Kural (K-0.2): Bir limite güvenmeden önce resmi kaynaktan doğrulanır ve buraya linkiyle yazılır.
> Son güncelleme: 2026-10-13 (Faz 0).

**Doğrulama yöntemi notu:** Bu çalışma ortamı resmi sitelere doğrudan bağlanamıyor (ağ politikası). Değerler web
araması üzerinden resmi sayfaların içeriğinden alındı. Durum sütunu:

- ✅ **Resmi**: değer resmi dokümandan geldi.
- ⚠️ **Kısmi**: resmi sayfa tam okunamadı veya kaynaklar çelişiyor; ilgili faz başlamadan önce hesabın kendi
  kota sayfasından (konsol/panel) gerçek değerle teyit edilecek. Kodda bu değerler koda sabitlenmez; `settings`
  tablosundaki `llm.quotas` gibi alanlara girilir.

## Özet: tasarımı etkileyen bulgular

1. **Cloudflare Workers ücretsiz: çağrı başına 10 ms CPU, 50 alt istek (subrequest), hesap başına 5 cron.**
   Ağ beklemesi CPU sayılmaz; ama her cron çağrısında en fazla 50 dış istek (DB + LLM) yapılabilir. Kuyruk
   dağıtıcısı bu yüzden tik başına iş sayısını sınırlayacak (Faz 1). Ağır işler zaten Actions'ta (K-3.16).
2. **Supabase ücretsiz proje 1 hafta hareketsiz kalırsa duraklatılır.** Worker cron'u her dakika veritabanına
   eriştiği için proje aktif kalır (V-7). Supabase ücretsiz katmanda yedek yok → gece yedeği (K-17.5) şart.
3. **Gemini ücretsiz katmanında gönderilen içerik Google'ın ürün geliştirmesinde kullanılır ve insan gözden
   geçirici görebilir.** Google, ücretsiz servislere hassas/kişisel veri gönderilmemesini açıkça söylüyor.
   (AB/İsviçre/İngiltere istisnası Türkiye'yi kapsamıyor.) → K-4.7 veri sınıflandırma kuralı zorunlu.
4. **TOTP iki aşamalı doğrulama Supabase'de tüm planlarda ücretsiz.** Zorunlu kılmak uygulamanın işi; Papi'de
   panel + RLS (`aal2`) ile zorunlu (K-17.1).
5. **GitHub Actions: herkese açık repoda standart koşucular ücretsiz; özel repoda ayda 2.000 dakika.**
   Varsayılan harcama limiti 0 $ olduğu için aşımda ücret çıkmaz, işler durur. Bkz. "Actions bütçesi".

## Cloudflare

| Servis                 | Limit (ücretsiz)                                                      | Durum                                | Kaynak                                                                       |
| ---------------------- | --------------------------------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------- |
| Workers istek          | 100.000 / gün                                                         | ✅                                   | [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) |
| Workers CPU            | 10 ms / HTTP isteği, 10 ms / cron çağrısı                             | ✅                                   | aynı                                                                         |
| Workers alt istek      | 50 / istek                                                            | ✅ (eski sayfa farklı değer veriyor) | aynı                                                                         |
| Cron Triggers          | 5 / hesap                                                             | ✅                                   | aynı                                                                         |
| Worker boyutu / bellek | 3 MB / 128 MB                                                         | ✅                                   | aynı                                                                         |
| Pages build            | 500 / ay (hesap mı proje mi belirsiz), aynı anda 1, 20 dk zaman aşımı | ⚠️                                   | [Pages limits](https://developers.cloudflare.com/pages/platform/limits/)     |
| Pages dosya            | 20.000 dosya / site, 25 MiB / dosya                                   | ✅                                   | aynı                                                                         |
| Turnstile              | 20 widget / hesap, sınırsız doğrulama                                 | ✅                                   | [Turnstile plans](https://developers.cloudflare.com/turnstile/plans/)        |

## Supabase

| Kalem          | Limit (ücretsiz)                                                | Durum | Kaynak                                                                 |
| -------------- | --------------------------------------------------------------- | ----- | ---------------------------------------------------------------------- |
| Proje          | 2 aktif proje                                                   | ✅    | [Pricing](https://supabase.com/pricing)                                |
| Veritabanı     | 500 MB / proje                                                  | ✅    | aynı                                                                   |
| Hareketsizlik  | 1 hafta sonra duraklatma, veri korunur, elle yeniden başlatılır | ✅    | aynı                                                                   |
| Auth MAU       | 50.000                                                          | ✅    | aynı                                                                   |
| Dosya depolama | 1 GB (bazı kaynaklar 500 MB diyor)                              | ⚠️    | aynı                                                                   |
| Egress         | 5 GB (bazı kaynaklar 2 GB diyor)                                | ⚠️    | aynı                                                                   |
| Yedekleme      | Ücretsizde yok                                                  | ✅    | aynı                                                                   |
| TOTP MFA       | Ücretsiz, tüm projelerde varsayılan açık                        | ✅    | [Auth MFA (TOTP)](https://supabase.com/docs/guides/auth/auth-mfa/totp) |

## GitHub Actions

| Kalem                   | Limit                                                            | Durum | Kaynak                                                                                                                     |
| ----------------------- | ---------------------------------------------------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------- |
| Herkese açık repo       | Standart koşucular ücretsiz                                      | ✅    | [Actions billing](https://docs.github.com/en/billing/managing-billing-for-github-actions/about-billing-for-github-actions) |
| Özel repo (GitHub Free) | 2.000 dk / ay                                                    | ✅    | aynı                                                                                                                       |
| Aşım                    | Varsayılan harcama limiti 0 $ → aşımda işler durur, ücret çıkmaz | ✅    | aynı                                                                                                                       |

### Actions bütçesi (özel repo varsayımıyla)

GitHub dakikaları iş başına yukarı yuvarlar. Şu anki CI 4 iş çalıştırıyor; ölçülen süreler: lint/test/build
~30 sn, gizli tarama ~5 sn, Playwright ~35 sn, veritabanı (gerçek Supabase) ~ölçülecek. Push başına yaklaşık
**5–7 faturalanan dakika**.

| Kullanım                                     | Tahmini dakika / ay |
| -------------------------------------------- | ------------------- |
| CI (ayda ~150 push)                          | ~900                |
| Gece yedeği (günde ~2 dk)                    | ~60                 |
| Tarayıcı/toplu analiz (Faz 2+, günde ~15 dk) | ~450                |
| **Toplam**                                   | **~1.400 / 2.000**  |

Repo herkese açık olursa bu sınır kalkar (A-4 açık karar).

## LLM ve ses

| Servis                         | Limit (ücretsiz)                                                                                                         | Durum                                  | Kaynak                                                                     |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------------------------------------------- |
| Gemini veri kullanımı          | Ücretsiz katmanda girdi/çıktı ürün geliştirmede kullanılır, insan gözden geçirebilir; hassas/kişisel veri gönderilmemeli | ✅                                     | [Gemini API Additional Terms](https://ai.google.dev/gemini-api/terms)      |
| Gemini metin modelleri         | Model bazında RPM/RPD; kaynaklar çelişiyor (Flash için 250–1.500 RPD)                                                    | ⚠️ Faz 1'de AI Studio kota sayfasından | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)           |
| Gemini Google Search grounding | Ücretsizde günde ~500 istek (Flash + Flash-Lite ortak)                                                                   | ⚠️ Faz 2'de                            | [Pricing](https://ai.google.dev/gemini-api/docs/pricing)                   |
| Gemini embedding               | Ücretsiz katmanda var; limit teyit edilemedi                                                                             | ⚠️ Faz 1'de                            | [Rate limits](https://ai.google.dev/gemini-api/docs/rate-limits)           |
| Gemini Live                    | Ücretsiz katman ülkeye bağlı; oturum ~10–15 dk; eşzamanlı oturum sınırı belirsiz; geçici token yalnızca Live API için    | ⚠️ Faz 7'de                            | [Ephemeral tokens](https://ai.google.dev/gemini-api/docs/ephemeral-tokens) |
| Groq LLM                       | Model bazında RPM/RPD/TPM                                                                                                | ⚠️ Faz 1'de konsoldan                  | [Groq rate limits](https://console.groq.com/docs/rate-limits)              |
| Groq Whisper                   | ~20 RPM, 2.000 RPD, 7.200 ses-sn/saat, 28.800 ses-sn/gün; en kısa faturalanan 10 sn                                      | ⚠️ Faz 1'de konsoldan                  | aynı                                                                       |
| TTS (ElevenLabs / Gemini TTS)  | Faz 1'de karşılaştırılacak (A-3)                                                                                         | —                                      | —                                                                          |

## Diğer

| Servis                 | Limit                                                                  | Durum                                      | Kaynak                                                                      |
| ---------------------- | ---------------------------------------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| PageSpeed Insights API | ~25.000 istek/gün, ~240/dk; API anahtarı için faturalandırma gerekmez  | ⚠️ Faz 2'de Cloud Console kota sayfasından | [PSI API](https://developers.google.com/speed/docs/insights/v5/get-started) |
| Sentry Developer       | ~5.000 hata/ay, 1 kullanıcı; **kart isteyip istemediği doğrulanamadı** | ⚠️                                         | [Sentry pricing](https://sentry.io/pricing/)                                |
| Overpass API           | Kullanım politikası Faz 2'de                                           | —                                          | [Overpass](https://wiki.openstreetmap.org/wiki/Overpass_API)                |
| Telegram Bot API       | Ücretsiz                                                               | —                                          | [Bot API](https://core.telegram.org/bots/api)                               |
| Instagram Graph API    | Faz 2'de                                                               | —                                          | [Graph API](https://developers.facebook.com/docs/instagram-platform)        |

## Hata takibi kararı için öneri (A-2)

Sentry'nin kart isteyip istemediği doğrulanamadığı için öneri: **kendi hata tablon** (`error_events`, Faz 1).
Worker ve Actions hataları bu tabloya yazılır, panelde "Sistem sağlığı" altında görünür, kritik olanlar Telegram'a
anında gider. Sentry istenirse ileride adaptör olarak eklenebilir.
