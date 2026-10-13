# Faz 7 planı — Dış yüz ve sertleştirme

Durum: **Onay bekliyor** (E-1, E-2, E-3).
Kabul: Uçtan uca senaryo geçiyor · yedek geri yükleniyor · ücretsiz limitler içinde kalındığı ölçütlerde görülüyor.

## Adımlar

1. **Analiz aracı (K-12):** herkese açık form (işletme adı veya sitesi + e-posta), KVKK aydınlatma linki ve açık onay
   kutusu zorunlu, Turnstile + IP hız sınırı + günlük toplam limit (ayarlardan). Analiz mevcut hattan geçer
   (PageSpeed, site sinyalleri, yorum/kanal kontrolü), rapor şablon + kısa model özetiyle (yalnızca herkese açık veri)
   hazırlanır. Rapor onaysız gider (ana kurallardaki tek istisna); reddedenler listesi yine kontrol edilir. Kişi + firma
   CRM'e "Sıcak Gelen" olarak düşer, Telegram'a anında bildirim gelir, firma Sıcak Gelen playbook'una girer.
   Bkz. E-2.
2. **Siteye ekleme rehberi:** Netlify'daki AJNA sitesine tek satır gömme kodu (iframe) veya ayrı sayfa linki;
   `docs/analiz-araci-ekleme.md`.
3. **Canlı sesli konuşma (K-3.10, K-15.6):** panelde "Papi ile konuş". Worker, Gemini Live için kısa ömürlü,
   tek kullanımlık token üretir (API anahtarı tarayıcıya hiç gitmez). Günlük dakika limiti ayarlardan, kalan süre
   ekranda. Araçlar: bkz. E-3. Konuşma özeti yazıya dökülüp Papi'nin geçmişine eklenir.
4. **Müşteri portalı (K-13.11):** altyapı kurulur, `client_portal` bayrağı kapalı gelir. Müşteri kullanıcısı yalnızca
   kendi projesini (durum, kontrol listesi, aylık rapor, ödemeler) görür; RLS ile zorunlu, pgTAP testli. Bayrak
   kapalıyken müşteri girişi tamamen reddedilir.
5. **Gece yedeği (K-17.5):** her gece Actions'ta `pg_dump` → sıkıştırma → `age` ile şifreleme (açık anahtar repoda,
   gizli anahtar yalnızca sende) → hedef: bkz. E-1. Haftalık otomatik **geri yükleme testi**: yedek boş bir
   Postgres'e açılır, tablo sayıları ve birkaç kontrol sorgusu doğrulanır, sonuç Telegram'a. Geri yükleme adımları
   `docs/yedekten-geri-yukleme.md`.
6. **Veri saklama ve silme (K-17.7):** kazanılmayan adayların kişisel verileri 12 ay (ayarlardan) sonra otomatik
   anonimleştirilir (ad/e-posta/telefon silinir, firma ve sayılar kalır); panelde firma/kişi için "tek tık veri
   sil" (reddedenler listesine eklenir, audit'e yazılır). KVKK aydınlatma metni şablonu + "avukat/mali müşavir
   kontrolü gerekir" ve İYS notu.
7. **Sertleştirme:** gizli bilgi taraması (gitleaks tüm geçmiş, CI'da), bağımlılık denetimi (`pnpm audit`),
   herkese açık uçların gözden geçirmesi (hız sınırları, başlıklar, CORS), RLS'nin tüm tablolarda açık olduğunu
   doğrulayan test, `SUPABASE_ACCESS_TOKEN` dar yetkiyle yeniden oluşturma talimatı (V-23).
8. **Uçtan uca senaryo testi:** sahte sağlayıcılarla tek test: link → analiz → puan → playbook → onay → gönderim →
   cevap → görüşme notu → teklif → kabul → proje → kurulum formu → aylık rapor; ayrıca analiz aracından gelen
   Sıcak Gelen yolu.
9. **Ücretsiz limit ölçütü:** Ölçütler → Sistem sağlığı'na aylık görünüm: LLM kotaları, Worker istekleri (cron
   sayısıyla tahmin), Supabase veritabanı boyutu, Actions dakikası (iş sürelerinden hesap), yedek boyutu; her biri
   limitle yan yana.
10. **Teslim dokümanları (K-19.1):** kurulum/yeniden kurulum, yedekten geri yükleme, yeni entegrasyon, yeni playbook,
    Claude'a geçiş, Places ve WhatsApp Business'ı açma rehberleri; varsayımlar ve açık noktalar listesi.

## Onayın gereken üç karar

- **E-1 — Yedeklerin hedefi (A-5).** Öneri: **GitHub Actions artifact**, 30 gün saklama. Ek token veya repo
  gerekmez, şifreli olduğu için repo okunsa bile içerik açılmaz; günlük yedek birkaç MB, özel repo artifact
  kotasının (doğrulanacak) çok altında. Ayda bir yedek ayrıca 90 gün saklanır. Alternatif: ayrı özel repo
  (kalıcı geçmiş, ama yazma yetkili ek token ve repo büyümesi).
- **E-2 — Analiz aracının yeri ve raporun teslimi.** Öneri: araç Worker'da `/analiz` sayfası; AJNA sitesine iframe
  ile gömülür. Rapor hem ekranda (tahmin edilemez linkle, 30 gün) gösterilir hem de mail bağlandığında (A-1) mail
  ile gider; mail bağlanana kadar yalnızca ekranda. Alternatif: rapor yalnızca mail ile (A-1 kararı verilmeden araç
  açılamaz).
- **E-3 — Sesli konuşmada Papi'nin araçları.** Öneri: yalnızca **okuma** araçları (bilgi bankası, notlar, CRM'de
  firma arama, bugünün özeti, kota) + not alma ve sessiz mod. Dışarı giden her şey yine onay kuyruğuna taslak
  olarak düşer; sesli konuşmada onay verilmez. Günlük varsayılan limit 20 dakika. Alternatif: araçsız, yalnızca
  sohbet.

## Hesap adımları (masaüstü oturumuna eklenir)

- `age` anahtar çifti üretme (gizli anahtarı yalnızca sen saklarsın) ve açık anahtarın repoya eklenmesi.
- Turnstile'a analiz aracı alan adının eklenmesi.
- Gemini Live'ın ücretsiz katmanda ülkende açık olduğunun kontrolü.
