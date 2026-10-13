# Faz 6 planı — Zeka ve otomasyon

Durum: **Tamamlandı (kod)**, canlı kabul masaüstü kurulum oturumunda. D-1 → K-8.11, D-2 → K-3.18.
Kabul: `/uyuyorum` sonrası gece vardiyası çalışıyor, `/uyandim` ile özet geliyor; rutinler zamanında çalışıyor.

## Adımlar

1. **Rutin motoru:** `routines` tablosu (ad, zamanlama, eylem, parametreler, açık/kapalı, son çalışma, sonuç).
   Worker'ın dakikalık zamanlayıcısı vadesi gelen rutini kuyruğa koyar (Cloudflare ücretsiz planı 5 cron sınırı
   yüzünden ayrı cron açılmaz). Eylemler **izinli bir listeden** seçilir; rutin keyfi kod çalıştıramaz.
2. **Hazır rutinler (K-13.5):** sabah brifingi, bugün kimi aramalıyım, sinyal taraması, haftalık rakip taraması,
   sektör haberlerinden fırsat, ödeme gecikme kontrolü, aylık müşteri raporları, haftalık patron özeti
   (K-16.5). Hepsi ayarlardan açılıp kapanır, saatleri değişir.
3. **Doğal dille rutin:** "Her pazartesi 9'da bana sıcak adayları özetle" → model yalnızca yapıyı çıkarır
   (zamanlama + izinli eylem + parametre) → Timurhan onaylar → kaydedilir. Telegram ve panelden.
4. **Gece vardiyası (K-15.5):** `/uyuyorum` → sessiz mod + vardiya: aday bulma (OSM, grounding), tarama, analiz,
   puanlama, taslaklar, kuyruk doldurma — kota bütçesiyle. Mail gönderimi yine iş saatinde. `/uyandim` → vardiya
   özeti (kaç aday, kaç analiz, kaç taslak, hatalar). Otomatik sessiz pencere ayarlardan.
5. **Sinyal motoru:** bkz. D-1. Sinyal → yeniden puanlama → uygun firmalar Sinyal playbook'una; her sinyal firma
   kartında zaman çizelgesinde.
6. **Kalem (K-13.9):** haftalık içerik planı (LinkedIn, X, Instagram), taslaklar marka bilgisinden; şehir adı
   geçmez, mesaj "her işletme ve KOBİ'ye özgün çözümler". Onaylananlar tek tık kuyruğuna (X intent, LinkedIn,
   Instagram kopyala-yapıştır).
7. **Öğrenen sistem:** tekrar eden düzeltmeler → "öğrenilen kural" önerisi (K-6.8); playbook adım performansından
   değişiklik önerisi (K-11.6). Öneriler onay kuyruğunda; onaylanmadan hiçbir şey değişmez.
8. **Ölçütler ekranı (K-16):** MRR ve hedefe kalan, hattaki teklif değeri, ilk cevap süresi; huni (playbook/kanal
   filtreli); müşteri (aktif, müşteri başı gelir, iptal, yaklaşan yenilemeler); sistem sağlığı (kota, kuyruk,
   en uzun bekleyen onay, hatalar, Actions dakikaları).
9. **Harita ve ziyaret rotası (K-3.11, K-10.7):** Leaflet + OpenStreetMap; adaylar puan ve aşamaya göre renkli;
   seçilen günün ziyaret rotası (yakın komşu sıralaması) + firma başına yazdırılabilir tek sayfa analiz. Bkz. D-2.
10. **Hafıza:** notların ve görüşme özetlerinin anlam araması (ayıklanmış metinle embedding, K-4.9) Papi'nin
    araçlarına bağlanır (V-66).

## Onayın gereken iki karar

- **D-1 — Sinyal kaynakları.** Öneri: (a) yüksek puanlı firmaların sitesi haftada bir yeniden taranır, değişiklik
  (yeni kampanya, iş ilanı, yeni şube, randevu sistemi eklenmesi/kaldırılması) sinyal olur; (b) haftada en fazla
  20 firma için Gemini aramasıyla haber taraması (ücretsiz günlük arama kotasının küçük bir kısmı); (c) OSM'de
  ilgili sektörlerde yeni açılan işletmeler haftalık. Instagram bağlanırsa paylaşım sıklığı da eklenir.
  Alternatif: yalnızca site değişiklikleri (en ucuz, en az sinyal).
- **D-2 — Haritada konum.** Öneri: adresi olan firmaların konumu OpenStreetMap'in ücretsiz adres arama servisiyle
  (Nominatim; politika gereği 15 saniyede 1 istek, sonuç saklanır, atıf gösterilir) GitHub Actions'ta toplu bulunur. Alternatif:
  yalnızca OSM'den gelen firmalar haritada görünür (konumu zaten olanlar).
