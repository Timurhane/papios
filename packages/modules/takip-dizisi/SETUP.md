# Kurulum rehberi

1. Takip günlerini ve mesaj şablonlarını müşteriyle onayla (`papi-config.json` → `services`, `tone`).
2. Cevap asistanı Worker'ına zamanlanmış görev ekle (Cron Trigger, günde bir).
3. İlgilenen kayıtlarını KV/D1'de tut (müşterinin hesabı), cevap gelenleri işaretle.
4. Gönderim kanalı müşterinin hesabında (e-posta servisi ya da WhatsApp, onaylıysa).
5. `TESTS.md` listesini çalıştır.
