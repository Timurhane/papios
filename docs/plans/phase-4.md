# Faz 4 planı — Satış

Durum: **Uygulanıyor** (Timurhan onayladı; A-7 → K-4.9, B-1 → K-13.12).
Kabul: Sesli görüşme notundan teklif taslağı ve PDF oluşuyor · demo linki çalışıyor ve 14 gün sonra kapanıyor.

## Adımlar

1. **Veritabanı:** `meetings` (görüşme: zaman, kaynak, not, özet), `proposals` + `proposal_items` (paket, ödeme yolu,
   indirim, KDV durumu, geçerlilik, durum: taslak → onay → gönderildi → kabul/ret), `demos` (tahmin edilemez token'ın
   hash'i, firma, anlık görüntü, bitiş, ziyaret/mesaj sayacı), kurucu indirimi kontenjanını atomik düşüren fonksiyon.
   RLS + audit her tabloda.
2. **Çekirdek (saf, testli):** teklif hesabı (kuruş, iki ödeme yolu yan yana: kurulumsuz 12 ay / kurulumlu %15 düşük
   3 ay, K-7.4), kurucu indirimi (kurulumda en çok %40, aylıkta ilk 3 ay %20, yalnızca kontenjan gerçekten varsa,
   K-7.5), Özel paket formülü (parça × gün × günlük ücret + belirsizlik payı), KDV gösterimi (A-6: her teklifte
   sorulur), uygun görüşme saatleri (iş saati + takvim doluluk), kişisel veri ayıklayıcı (bkz. A-7).
3. **Satıcı ajanı:**
   - Görüşme öncesi brifing: analiz, en güçlü bulgu, önerilen paket, sorulacak 5 soru (herkese açık veriyle).
   - Görüşme sonrası: Telegram sesli not → Whisper → yapılandırılmış not (ihtiyaçlar, bütçe sinyali, itirazlar,
     sonraki adım) → teklif taslağı → onay kuyruğu.
   - Cevap taslakları: Gelen kutusundaki "ilgileniyor / soru" cevaplarına taslak → onay kuyruğu.
   - Görüşme önerisi: 3 uygun saat (Google Takvim doluluk bilgisi; bağlı değilse yalnızca iş saati), onaylanınca
     takvim etkinliği.
4. **Google Takvim adaptörü:** OAuth yenileme token'ı Worker secret'ında; `freeBusy` + etkinlik oluşturma. Bağlanana kadar
   kapalı adaptör (iş saati önerileri çalışır). Kurulum adımları `accounts.md`'ye (masaüstü oturumu).
5. **Teklif stüdyosu (panel):** paket seç → iki ödeme yolu yan yana → indirim → KDV → önizleme → PDF → onay → gönder
   (mail bağlanana kadar: PDF indir + WhatsApp tek tık). Gönderilen teklif firmayı Teklif Takibi playbook'una alır.
6. **PDF:** bkz. B-1.
7. **Kişiye özel demo:** Worker'da `/demo/{token}`: işletmeye özel 14 günlük sohbet asistanı. Yalnızca kendi anlık
   görüntüsünü okur (işletmenin herkese açık bilgileri + AJNA'nın paket özeti), başka hiçbir tabloya erişmez.
   Turnstile + IP hız sınırı + demo başına günlük mesaj sınırı + toplam günlük sınır (ayarlardan). Ziyaret ve mesaj
   sayısı firma kartına işlenir; süresi dolunca kapanış sayfası. Ziyaretçinin yazdıkları kişisel veri sayılır,
   saklanmaz, yalnızca sayılır.
8. **Panel:** Teklif stüdyosu, Kişiye özel demo listesi, firma kartında görüşmeler/teklifler/demolar, Bugün'de
   görüşmeler.
9. **Telegram:** `/teklif {firma}`, görüşme sonrası sesli not akışı, demo linki oluşturma.

## Onayın gereken iki karar

- **A-7 — Cevap ve görüşme notlarının modele gitmesi.** Gelen cevaplar ve görüşme notları kişisel veri içerebilir
  (K-4.7). Öneri: metin modele gitmeden önce kodla ayıklanır (e-posta, telefon, CRM'deki kişi adları, imza bloğu,
  TC/IBAN → yer tutucu); kalan işletme ihtiyacı "dahili" sınıfta ücretsiz modele gidebilir. Kazanılmış müşteri
  verisi hiçbir durumda gitmez. Alternatif: hiç gitmez; taslaklar yalnızca sınıf + herkese açık firma bilgisiyle yazılır
  (çok daha zayıf taslak).
- **B-1 — PDF nerede üretilir.** Öneri: panelde, tarayıcıda (pdf-lib + Türkçe destekli gömülü yazı tipi): anında, ücretsiz,
  Actions dakikası harcamaz; dosya Supabase Storage'a özel olarak yüklenir, Telegram'a link gelir. Alternatif: GitHub
  Actions'ta Playwright (daha zengin tasarım ama anında tetikleme token'ı yoksa 6 saate kadar gecikme).

## Hesap adımları (masaüstü oturumuna eklenir)

- Google Cloud OAuth uygulaması (Takvim; A-1'de Gmail seçilirse aynı uygulama) — ücretsiz, kart istemez.
- Cloudflare Turnstile site anahtarı (demo ve ileride analiz aracı) — ücretsiz.
