# Faz 5 planı — Operasyon

Durum: **Uygulanıyor** (Timurhan "devam"; C-1 → K-14.4, C-2 → K-14.5).
Kabul: "Kazanıldı" işaretlenen firma için proje + kurulum formu + Claude Code promptu oluşuyor.

## Adımlar

1. **Veritabanı:** `projects` (müşteri, paket, ödeme yolu, başlangıç, sözleşme bitişi, durum), `project_tasks`
   (kontrol listesi), `setup_forms` (kurulum formu: token, alanlar, gönderim), `clients` görünümü (kazanılmış firmalar),
   `finance_entries` (gelir/gider, kuruş), `subscriptions` (aylık ücret, dönem, sonraki tahsilat), `payments`
   (tahsilat; ödeme linki elle), `notes` (yazı/sesli not, etiket, firma/proje bağı, arama), müşteri verisi için
   `client_sensitive` sınıfı. RLS + audit her tabloda.
2. **Kazanıldı akışı (Operatör):** teklif kabul → proje açılır (paket + ödeme yolu tekliften), abonelik ve ilk
   tahsilat kaydı, kurulum formu linki, Müşteri Yaşamı ve Referans dizileri sözleşme tarihlerine göre başlar.
   Firmanın sıradaki adımı "kurulum formu bekleniyor".
3. **Kurulum formu:** pakete göre alanlar (çalışma saatleri, hizmetler/fiyatlar, sık sorulanlar, kanallar, bildirim
   alacak kişi, kullandığı program). Bkz. C-1.
4. **Operatör çıktıları (kodla, şablondan; model yok):** müşteriye özel yapılandırma dosyası (modülün JSON Schema'sına
   göre doğrulanır), Claude Code kurulum promptu, kontrol listesi → projeye bağlanır. Müşteri verisi hiçbir modele
   gitmez (K-4.7); prompt şablonla doldurulur.
5. **Teslim modülleri (`packages/modules`):** cevap asistanı, takip dizisi, randevu/ödeme hatırlatma, Google yorum
   toplama/cevaplama, aylık performans raporu. Her biri: README, JSON Schema, müşteri hesaplarında kurulum rehberi,
   test listesi. **Cevap asistanı çalışan referans implementasyon** (bkz. C-2).
6. **Finans:** gelir-gider, abonelikler, tahsilat takibi, MRR ve hedefe kalan; gecikmeyi Telegram'a bildirme
   (K-15.4). Ödeme linki ve fatura elle; iyzico/PayTR adaptörü kapalı.
7. **Notlar:** yazı ve sesli not, etiket, firma/projeye bağlama, metin + anlam araması (embedding'den önce kişisel veri
   ayıklanır, K-4.9).
8. **Müşteri Yaşamı ve Referans:** 1. hafta kontrolü, aylık rapor, yenilemeye 30 gün kala görüşme; 30. gün memnuniyet
   sorusu, olumluysa referans isteği.
9. **Aylık müşteri raporu:** modülün gönderdiği kişisel veri içermeyen sayılar (gelen mesaj, cevap süresi, yakalanan
   aday, randevu) → şablonla PDF → onaylı gönderim. Model kullanılmaz.
10. **Panel + Telegram:** Projeler, Finans, Notlar, Teslim modülleri ekranları; `/not`, `/tahsilat`, `/proje {firma}`.

## Onayın gereken iki karar

- **C-1 — Kurulum formunu kim doldurur?** Öneri: müşteriye güvenli bir link gider (tahmin edilemez anahtar,
  Turnstile, 30 gün geçerli), müşteri doldurur; sen panelden düzeltebilirsin. Alternatif: formu görüşmede sen
  doldurursun (link yok, daha az otomasyon).
- **C-2 — Cevap asistanı referans implementasyonu.** Öneri: müşterinin kendi Cloudflare hesabında çalışan bir Worker:
  site sohbet kutusu + Instagram DM (müşterinin Meta uygulaması) hazır; WhatsApp Business Cloud API adaptörü yazılır
  ama kapalı gelir (konuşma başına ücretli, ücret müşterinin). Yapay zeka müşterinin kendi anahtarıyla; müşterinin
  müşterilerinin mesajları kişisel veri olduğu için ücretli (eğitimde kullanılmayan) katman önerilir ve teklif/README'de
  yazılır. Alternatif: yalnızca site sohbet kutusu.
