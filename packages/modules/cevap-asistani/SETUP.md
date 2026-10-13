# Kurulum rehberi (müşterinin hesaplarında)

1. `worker/` klasörünü müşteriye özel yeni bir repoya kopyala. `packages/modules/src/config.ts` dosyasını
   `src/config.ts` üzerine yaz (monorepo dışında şema buradan okunur).
2. Papi panelinden indirilen `papi-config.json`'u `worker/` köküne koy.
3. `pnpm install && pnpm test` — config şemaya uymazsa testler kırılır.
4. Müşterinin Cloudflare hesabıyla `wrangler login`. `wrangler kv namespace create METRICS` → id'yi `wrangler.toml`'a yaz.
5. Secret'lar (`wrangler secret put ...`), **asla repoya değil**:
   - `LLM_API_KEY` (müşterinin anahtarı; ücretli katman önerilir)
   - `NOTIFY_TELEGRAM_TOKEN`, `NOTIFY_TELEGRAM_CHAT` (işletme sahibinin bildirim botu)
   - Instagram: `META_APP_SECRET`, `META_PAGE_TOKEN`, `META_VERIFY_TOKEN`
   - Site: `ALLOWED_ORIGIN` (ör. `https://isletme.com`)
   - WhatsApp (yalnızca müşteri onaylarsa): `WHATSAPP_ENABLED=true`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`
6. `pnpm deploy`. Çıkan adresi not et.
7. Site: `<script src="https://<worker-adresi>/widget.js" defer></script>` satırını sitenin `</body>` öncesine ekle.
8. Instagram: müşterinin Meta uygulamasında webhook = `https://<worker-adresi>/meta/webhook`, doğrulama anahtarı =
   `META_VERIFY_TOKEN`, `messages` aboneliği açık.
9. Cloudflare panelinde `/chat` için bir hız sınırı kuralı önerilir (ücretsiz planda 1 kural).
10. `TESTS.md` listesini çalıştır.
