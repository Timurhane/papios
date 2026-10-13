# Faz 1 planı — Beyin ve Telegram

Durum: **Uygulanıyor** (Timurhan "devam" dedi, 2026-10-13).
Kabul: Telegram'dan sesli not → Papi anlıyor, bilgi bankasından cevap veriyor · kota sınırında yedeğe geçiyor
(testli) · yabancı kullanıcı yok sayılıyor.

## Adımlar

1. **Veritabanı (migration):** `llm_calls`, `llm_cache`, `quota_usage` + `app.consume_quota()`, `error_events`,
   `conversation_messages`, `approvals`, `style_memory`, `memory_items` (firma hafızası), `runtime_state`
   (sessiz mod), vektör arama fonksiyonları (`app.match_*`) ve anahtar kelime yedeği.
2. **LLM katmanı (`packages/core/llm`):** `LLMProvider` arayüzü; Gemini (aktif), Groq (yedek + Whisper),
   Anthropic (kapalı) adaptörleri; seviye yönlendirme; dakika/gün kotası; yedeğe geçiş; önbellek; veri
   sınıflandırma kuralı; her çağrının `llm_calls` kaydı. Testler sahte sağlayıcılarla.
3. **İş kuyruğu:** işleyici kaydı, Worker cron dağıtıcısı (her dakika), üstel geri çekilme, ölü iş.
4. **Hafıza:** bilgi bankası/firma/stil hafızası gömme (embedding) işleri ve arama (önce vektör, yoksa anahtar kelime).
5. **Papi ajan döngüsü:** sağlayıcıdan bağımsız JSON araç protokolü, araç izin listesi, en fazla 4 adım
   (Workers alt istek bütçesi). Promptlar `packages/prompts` içinde versiyonlu.
6. **Telegram:** webhook gizli token doğrulaması, sahip kimliği beyaz listesi (yabancılar sessizce yok sayılır
   ve kayda geçer), yazı + sesli not (Whisper), komutlar, onay butonları (Onayla/Düzelt/Reddet, toplu), sessiz
   mod ve bildirim kuralları.
7. **Hata kaydı:** `error_events`; kritik hatalar Telegram'a anında.
8. **Model doğrulama işi:** yapılandırılan modeller sağlayıcıda yoksa Telegram'a uyarı.

## Bu fazda kapsam dışı (sonraki fazlar)

`/ekle` linki kuyruğa alır ama analiz Faz 2'de çalışır. Onaylanan işlerin gönderimi Faz 3'te. Gece vardiyasının
işleri Faz 6'da (sessiz mod ve özet bu fazda).

## Kabul için gereken canlı kurulum (toplu oturum)

Gemini ve Groq anahtarları, Telegram botu, Worker yayını ve secrets, Supabase deploy. Kod tarafı yerelde ve CI'da
testli teslim edilir.
