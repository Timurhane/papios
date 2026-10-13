# Analiz aracını AJNA sitesine ekleme (K-12.1)

Araç Worker'da çalışır: `https://<PUBLIC_API_URL>/analiz`. Siteye iki yoldan eklenebilir.

## 1. Gömme (önerilen)

Sitenin istediğin sayfasına (Netlify'da ilgili HTML dosyası veya sayfa oluşturucusunun "HTML ekle" bloğu):

```html
<iframe
  src="https://<PUBLIC_API_URL>/analiz"
  title="Ücretsiz dijital analiz"
  style="width:100%;min-height:720px;border:0;border-radius:16px"
  loading="lazy"
></iframe>
```

Worker bu sayfanın yalnızca izin verilen sitelerde gömülmesine izin verir. GitHub → repo → Settings → Secrets and
variables → Actions → **Variables** sekmesine bir değişken (gizli değil) ekle; API deploy iş akışı Worker'a aktarır:

- Ad: `ANALYSIS_EMBED_ORIGINS`
- Değer: `https://ajnadigitalagency.com` (birden fazla ise boşlukla: `https://ajnadigitalagency.com https://www.ajnadigitalagency.com`)

## 2. Link

Sitede bir buton: "Ücretsiz analiz" → `https://<PUBLIC_API_URL>/analiz` (yeni sekmede).

## Gerekenler (masaüstü kurulum oturumu)

- Turnstile site anahtarına analiz aracının alan adını (Worker alan adı) ekle; `TURNSTILE_SITE_KEY` ve
  `TURNSTILE_SECRET_KEY` Worker'da tanımlı olmalı. Canlıda Turnstile zorunludur.
- `PUBLIC_API_URL` tanımlı olmalı (rapor linkleri ve e-postadaki çıkış linki için).
- Aydınlatma metni: Ayarlar → `analysis_tool.privacy_url` boşsa yerleşik şablon (`/analiz/aydinlatma`) gösterilir.
  **Yayına almadan önce bir hukukçuya kontrol ettir.** İYS (ticari elektronik ileti) yükümlülükleri için bir uzmana
  danış.
- Mail bağlanana kadar (A-1) rapor yalnızca ekranda gösterilir; bağlandıktan sonra e-postayla da gider (K-12.6).

## Limitler (Ayarlar → analysis_tool)

- `daily_limit`: günlük toplam analiz (varsayılan 20)
- `per_ip_per_hour`: aynı IP'den saatte en fazla istek (varsayılan 3; IP özetlenerek tutulur)
- `report_days`: rapor linkinin açık kalma süresi (varsayılan 30 gün)
