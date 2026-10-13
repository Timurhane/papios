# Kurulum rehberi

1. `papi-config.json` içindeki `papi.metrics_url` ve `papi.metrics_token` değerlerini doğrula.
2. Cevap asistanı Worker'ının aylık Cron Trigger'ı (`0 6 1 * *`) açık olsun.
3. Diğer modüller kendi sayılarını aynı KV anahtarına (`m:YYYY-MM`) ekler.
4. `TESTS.md` listesini çalıştır.
