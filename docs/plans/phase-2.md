# Faz 2 planı — Aday ve analiz

Durum: **Uygulanıyor** (Timurhan "devam" dedi).
Kabul: Telegram'a atılan bir link 5 dakika içinde puanlı ve analizli firma kartına dönüşüyor.

## Mimari karar (V-33)

- **Hızlı analiz Worker'da:** tek link için ana sayfa + iletişim sayfası `fetch`, PageSpeed Insights (yalnızca gereken
  alanlar istenir), kural tabanlı kontroller, tek model çağrısıyla özet + sektör, puan. Ağ beklemesi CPU sayılmaz;
  HTML 300 KB ile sınırlanır.
- **Derin tarama GitHub Actions'ta (K-3.6):** Playwright ile çok sayfalı/JS siteler, toplu analiz, OSM ve grounding
  aramaları. Actions dakika bütçesi için zamanlama seyrek (6 saatte bir) + istenirse Worker'dan anında tetikleme
  (GitHub token'ı verilirse).

## Adımlar

1. **Veritabanı:** `companies` (sıradaki adım zorunlu, K-2.5), `contacts`, `analyses`, `score_history`, `signals`,
   `company_events` (zaman çizelgesi), mükerrer önleyen tekil indeksler, CSV içe aktarma RPC'si.
2. **Çekirdek (saf, testli):** URL/telefon/isim normalizasyonu, mükerrer kontrolü, link türü tespiti (site,
   Instagram, harita), HTML sinyal çıkarımı, PageSpeed özeti, puanlama + Türkçe gerekçe, CSV ayrıştırma.
3. **Analist:** kural kontrolleri → tek model çağrısı (3 madde + en güçlü bulgu + sektör/şehir) → puan → playbook
   ataması (70+ Soğuk Ana, 50–69 Hafif Soğuk, <50 bekleme listesi + yeniden değerlendirme tarihi).
4. **Kaşif kaynakları:** Telegram linki, CSV, OSM Overpass, Gemini grounding (doğrulanmadan CRM'e girmez),
   Instagram business discovery (Meta bilgileri gelince), Google Places (kapalı adaptör).
5. **Actions işçisi (`apps/jobs`):** ağır işleri kuyruktan alır; Playwright derin tarama.
6. **Panel:** CRM listesi + kanban + firma kartı (puan gerekçesi, analiz, zaman çizelgesi, sıradaki adım),
   CSV yükleme, Bugün ekranının ilk hali.
7. **Telegram:** `/ekle` ve linkli mesajlar → anında analiz → kart özeti mesajı.
