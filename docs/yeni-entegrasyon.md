# Yeni entegrasyon ekleme (K-13.10)

Her dış servis bir **adaptör** arkasındadır; bağlanana kadar "kapalı" çalışır ve sistemi bozmaz.
Örnekler: `GoogleCalendar` / `DisabledCalendar`, `MailTransport` / `DisabledMailTransport`,
`InstagramDiscovery`, `GooglePlaces` (kapalı), `LLMProvider` adaptörleri.

## Kontrol listesi

1. **Ücret:** servis ücretsiz ve kart istemiyor mu? Resmi dokümandan doğrula, `docs/free-tier-limits.md`'ye
   kaynak linkiyle yaz. Ücretli ise dur ve Timurhan'a sor (CLAUDE.md ilke 2).
2. **Arayüz:** `packages/server/src/services/` veya `adapters/` altında bir `interface` + gerçek sınıf + kapalı
   sınıf. Kapalı sınıf `configured = false` döner ya da açıklayıcı bir hata fırlatır.
3. **Gizli bilgiler:** anahtarlar yalnızca GitHub secrets → `api-deploy.yml` "Sync Worker secrets" listesine ad
   eklenir; `apps/api/src/env.ts` şemasına isteğe bağlı alan; `.env.example`'a boş satır.
4. **Bağlama:** `apps/api/src/deps.ts` composition root'unda anahtarlar varsa gerçek, yoksa kapalı sınıf.
5. **Bayrak:** dışarıya mesaj atan veya ücret doğurabilecek her şey `feature_flags`'ta kapalı bir bayrakla gelir
   (`supabase/seed/10_tenant.sql`).
6. **Veri sınıfı:** entegrasyondan gelen veri kişisel mi, müşteri verisi mi? Ücretsiz modellere gitmemeli
   (K-4.7); gerekiyorsa `redactPersonal` (K-4.9).
7. **Dışarı giden mesaj:** merkezi koruma `checkOutbound` (reddedenler listesi, onay, iş saati) atlanamaz; audit
   log'a yazılır.
8. **Testler:** sahte adaptörle birim testi (`MemoryRepo`), kapalıyken davranış testi, Worker uç noktası varsa
   `apps/api` testi.
9. **Belgeler:** `docs/setup/accounts.md`'ye hesap açma adımları, `docs/architecture.md`'ye bir satır.

## Araç (Papi'nin kullanacağı) olarak eklemek

Papi'nin araçları `apps/api/src/papi/tools.ts`'de izinli liste olarak tanımlıdır (zod ile doğrulanan argümanlar).
Sesli konuşma araçları ayrı ve yalnızca okuma amaçlıdır (`apps/api/src/voice.ts`, K-15.7); yeni bir araç
eklenirse token'a kilitlenen listeye de eklenmesi gerekir.
