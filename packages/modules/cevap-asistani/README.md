# Cevap asistanı

Site sohbet kutusu, Instagram DM ve (müşteri onaylarsa) WhatsApp'tan gelen mesajlara işletme adına anında cevap verir.
Telefon ya da e-posta bırakan kişiyi **ilgilenen** sayar ve işletme sahibine Telegram'dan bildirir.

- Paketler: Refleks, Sistem, Operasyon
- **Çalışan referans implementasyon:** `worker/` (Cloudflare Worker, müşterinin kendi hesabında, K-7.6)
- Yapılandırma: `papi-config.json` (Papi panelinden indirilir, şema: `config.schema.json`)

## Nasıl çalışır

- `GET /widget.js` → sitedeki sohbet kutusu (tek satır `<script>`).
- `POST /chat` → mesaj + kısa geçmiş → yapay zeka cevabı (yalnızca config'teki işletme bilgileriyle).
- `/meta/webhook` → Instagram DM (ve açılırsa WhatsApp); imza `X-Hub-Signature-256` ile doğrulanır.
- Aylık sayılar (gelen mesaj, cevap, ilgilenen) KV'de tutulur, her ayın 1'inde Papi'ye gönderilir. Kişisel veri gönderilmez.

## Gizlilik

Müşterinin müşterilerinin mesajları kişisel veridir. Yapay zeka **müşterinin kendi anahtarıyla** çalışır ve
**ücretli, eğitimde kullanılmayan** katman önerilir (K-14.5). Mesajlar saklanmaz; yalnızca sayılır.

## WhatsApp

WhatsApp Business Cloud API konuşma başına ücretlidir ve ücreti müşteri öder. Adaptör yazılıdır ama
`WHATSAPP_ENABLED=true` verilmedikçe kapalıdır.
