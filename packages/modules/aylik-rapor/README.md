# Aylık performans raporu

Modüllerin topladığı **kişisel veri içermeyen** sayılar (gelen mesaj, cevap, cevap süresi, ilgilenen, randevu,
hatırlatma, yorum) her ayın 1'inde Papi'ye gönderilir. Papi raporu şablonla hazırlar ve Timurhan'ın onayıyla
müşteriye yollar.

- Paketler: Refleks, Sistem, Operasyon
- Uç nokta: `papi.metrics_url` (`POST`, `Authorization: Bearer <papi.metrics_token>`)
- Gövde: `{ "period": "YYYY-MM-01", "metrics": { "messages_in": 412, "leads": 37 } }` (en çok 20 sayı)
