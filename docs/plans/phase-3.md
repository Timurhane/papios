# Faz 3 planı — Ulaşma

Durum: **Uygulanıyor.** Mail altyapısı (A-1) Timurhan'ın kararını bekliyor; mail gönderimi/okuma bir `MailTransport`
arayüzünün arkasında, karar gelince bağlanır.
Kabul: Bir aday Soğuk Ana'ya giriyor · onaylanan mail iş saatinde gidiyor · cevap gelince dizi duruyor ·
"yazmayın" diyen hiçbir yoldan mesaj alamıyor.

## Adımlar

1. **Veritabanı:** `enrollments` (firma ↔ playbook), `touches` (her temas: kanal, adım, taslak, onay, zamanlama,
   gönderim), `inbox_messages` (gelen cevaplar + sınıf), reddedenler kontrolünü zorunlu kılan tetikleyici.
2. **Çekirdek (saf, testli):** playbook motoru (gün ofseti, koşullar, atlama), iş saati penceresi, haftalık 2 temas
   sınırı, ısınma + günlük limit, rastgele aralık, soğuk mail ≤ 80 kelime, çıkış linki, imzalı çıkış token'ı, cevap
   sınıflandırma kuralları (yazmayın / otomatik yanıt / sonra / hayır / ilgileniyor / soru).
3. **Merkezi gönderim koruması (`outbound guard`):** reddedenler + onay + iş saati + haftalık sınır + kanal kuralları
   ve audit. Gönderen her yol bundan geçer; geçmezse gönderilemez.
4. **Ulak:** adım için taslak (şablon + kişisel kısım, ton profili, yasaklı ifadeler, stil hafızası) → onay kuyruğu.
5. **Mail:** `MailTransport` arayüzü; onaylı mailleri iş saatinde, günlük limit ve ısınmayla gönderen iş; gelen
   kutusunu yoklayan iş (A-1 kararından sonra gerçek uygulama).
6. **Tek tık kuyruğu:** WhatsApp (`wa.me`), Instagram, LinkedIn, X (intent); "Gönderdim" → temas kaydı → dizi ilerler.
7. **Çıkış linki:** Worker'da `/u/{token}` sayfası + tek tık (RFC 8058) → global reddedenler listesi.
8. **Gelen kutusu:** sınıflandırma (kişisel veri ücretsiz modele gitmez → kural tabanlı), dizinin durması, sıcak
   cevap bildirimi, "yazmayın" → reddedenler.
9. **Panel:** Gelen kutusu, Playbook'lar (adımlar + adım bazında performans), panelden onay, Bugün'de tek tık kuyruğu.
