# Google Places ve WhatsApp Business'ı açma (K-8.8, K-10.2)

İkisi de **ücretli** (kart/ödeme yöntemi ister); bu yüzden kod hazır ama kapalıdır. Açmak Timurhan'ın kararıdır.

## Google Places (aday bulma)

Neden kapalı: Places API, Google Cloud'da faturalandırma hesabı (kart) ister. Aylık ücretsiz kullanım kredisi
olsa da kart şartı "sıfır maliyet / kartsız" ilkesine takılır (CLAUDE.md ilke 2).

Açmak için:

1. Google Cloud Console → faturalandırma hesabı → Places API (New) etkinleştir.
2. **Bütçe uyarısı** kur (Billing → Budgets & alerts), örneğin aylık 1 USD; ve API kotasını günlük düşük bir
   sayıyla sınırla (APIs & Services → Places API → Quotas).
3. Anahtar oluştur, yalnızca Places API'ye kısıtla → GitHub secret `GOOGLE_PLACES_API_KEY`.
4. `feature_flags` → `adapter_google_places = true`.
5. Kod: `packages/server/src/adapters/places.ts` (`GooglePlaces`). Kaşif'in aday bulma akışı bayrak açıkken
   OSM'nin yanında Places'i de kullanacak şekilde bağlanır (Claude bu adımı birlikte yapar; testleri hazır).

## WhatsApp Business Cloud API (otomatik gönderim)

Neden kapalı: Meta, işletme tarafından başlatılan konuşmaları ücretlendirir ve ödeme yöntemi ister. Şu an WhatsApp
mesajları **tek tık** ile Timurhan'ın kendi WhatsApp'ından gider (K-10.2–K-10.4); bu ücretsizdir.

Açmak için:

1. Meta for Developers → uygulama → WhatsApp ürünü → işletme numarası doğrulama, ödeme yöntemi.
2. Mesaj şablonlarını onaya gönder (ilk temas için şablon zorunlu).
3. Kalıcı erişim anahtarı → GitHub secrets (`WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`).
4. `feature_flags` → `adapter_whatsapp_business = true`.
5. Gönderim yine merkezi korumadan geçer: onay, reddedenler listesi, iş saati, kişi başı haftalık limit.

Müşteriye teslim edilen **cevap asistanında** WhatsApp adaptörü müşterinin kendi Meta hesabıyla çalışır ve ücret
müşteriye aittir (K-14.5); ayrıntı `packages/modules/cevap-asistani/README.md`.
