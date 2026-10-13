# Hesap ve anahtar kontrol listesi

> K-0.3: Hesapları ve anahtarları Timurhan açar. Claude adım adım talimat verir ve bekler.
> K-0.4: Hiçbir değer repoya, sohbete veya koda yazılmaz. Gizli değerler yalnızca kasalara girer.
> Panel arayüzlerindeki menü adları zamanla değişebilir; bulamadığın bir şey olursa ekran görüntüsüyle sor.

Durum: ⬜ yapılmadı · ✅ tamam · ⏸ ileriki faz

| #   | Hesap                                                  | Gerektiği faz                                   | Durum |
| --- | ------------------------------------------------------ | ----------------------------------------------- | ----- |
| 1   | Supabase projesi                                       | Faz 0                                           | ⬜    |
| 2   | GitHub Actions secrets (Supabase)                      | Faz 0                                           | ⬜    |
| 3   | Panel kullanıcısı + sahiplik bağlantısı                | Faz 0                                           | ⬜    |
| 4   | Cloudflare hesabı + Pages (panel yayını)               | Faz 0                                           | ⬜    |
| 5   | Google AI Studio (Gemini) anahtarı                     | Faz 1                                           | ⏸     |
| 6   | Groq anahtarı                                          | Faz 1                                           | ⏸     |
| 7   | Telegram botu (BotFather) + kullanıcı kimliğin         | Faz 1                                           | ⏸     |
| 8   | Cloudflare Workers secrets                             | Faz 1                                           | ⏸     |
| 9   | Meta geliştirici uygulaması + Instagram işletme hesabı | Faz 2 (isteğe bağlı; onay süreci uzun olabilir) | ⬜    |
| 10  | Google Cloud: PageSpeed Insights API anahtarı          | Faz 2                                           | ⬜    |
| 11  | Natro mail bilgileri (yalnızca A-1 kararı için)        | Faz 3 öncesi                                    | ⏸     |
| 12  | Turnstile site anahtarı                                | Faz 7                                           | ⏸     |

---

## 1. Supabase projesi

1. https://supabase.com adresinde GitHub hesabınla veya e-postayla kayıt ol. **Kart istenirse dur ve bana yaz.**
2. **New project**:
   - Organization: kişisel organizasyonun (Free plan).
   - Name: `papi`
   - Database password: **Generate** ile güçlü bir şifre üret, şifre yöneticine kaydet. (Adım 2'de lazım.)
   - Region: **Central EU (Frankfurt)**.
3. Proje açılınca **Authentication → Sign In / Providers** (veya **Auth settings**):
   - **Allow new users to sign up**: **kapalı**.
   - Email provider açık kalsın.
4. **Authentication → Multi-Factor** (MFA): **TOTP (App Authenticator)** açık olmalı (varsayılan açık).
5. **Authentication → URL Configuration**: Site URL şimdilik `http://localhost:5173` kalsın; Adım 4'te panel adresiyle değiştireceğiz.
6. Bana yalnızca şunu yaz: "Supabase hazır, proje ref: `xxxx`". Proje ref, proje adresindeki
   `https://<ref>.supabase.co` kısmıdır ve gizli değildir. **Şifreyi veya anahtarları yazma.**

## 2. GitHub Actions secrets

> **Yenileme:** `SUPABASE_ACCESS_TOKEN` 90 günlük (oluşturma 2026-10-13 → bitiş ~2027-01-11).
> Bitmeden yeni token alınıp GitHub secret'ı güncellenir. (Faz 6 rutinlerine "anahtar süresi yaklaşıyor"
> hatırlatması eklenecek.)

1. Supabase → sağ üst profil → **Account preferences → Access Tokens → Generate new token**, adı `papi-github-actions`.
2. GitHub → `Timurhane/papios` → **Settings → Secrets and variables → Actions → New repository secret**:
   - `SUPABASE_ACCESS_TOKEN` = az önce aldığın token
   - `SUPABASE_DB_PASSWORD` = Adım 1'deki veritabanı şifresi
   - `SUPABASE_PROJECT_REF` = proje ref
3. Bana "secrets eklendi" yaz. Ben de **DB deploy** iş akışını çalıştırıp migration ve seed'i uygularım.

## 3. Panel kullanıcısı

1. Supabase → **Authentication → Users → Add user → Create new user**: kendi e-postan + güçlü şifre,
   **Auto Confirm User** işaretli.
2. Supabase → **SQL Editor**'de şunu çalıştır (e-postanı yaz):
   ```sql
   select app.attach_owner('ajna', 'senin@epostan.com');
   ```
3. Bana "kullanıcı bağlandı" yaz.

## 4. Cloudflare Pages (panel)

1. https://dash.cloudflare.com hesabı aç (kart istenmez; istenirse dur).
2. **Workers & Pages → Create → Pages → Connect to Git** → `Timurhane/papios`.
3. Build ayarları:
   - Production branch: `main`
   - Framework preset: None
   - Build command: `pnpm install --frozen-lockfile && pnpm --filter @papi/web build`
   - Build output directory: `apps/web/dist`
   - Environment variables:
     - `NODE_VERSION` = `22`
     - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
     - `VITE_SUPABASE_ANON_KEY` = Supabase → **Project Settings → API Keys** → **Publishable key**
       (eski adıyla _anon key_; tarayıcıda görünmesi güvenlidir, RLS korur)
     - `VITE_ALLOWED_EMAIL` = panele giriş yapacak e-postan
   - Değişkenleri hem **Production** hem **Preview** ortamına gir.
   - **Secret key / service_role anahtarını buraya asla koyma.**
   - Not: PR #1 `main`'e birleşene kadar `main` boş; Faz 0 kabul testini PR dalının **Preview** adresiyle yaparız.
4. Yayın bitince çıkan `https://papi-xxx.pages.dev` adresini GitHub → Settings → Secrets and variables → Actions →
   **Variables** sekmesine `PANEL_URL` olarak ekle (Telegram kartlarındaki linkler için). Aynı adresi Supabase → **Authentication → URL Configuration → Site URL**
   alanına yaz.
5. Adrese gir: giriş yap → QR kodu doğrulama uygulamanla okut → 6 haneli kodu gir → panel açılır.
   Bana sonucu yaz (sorun varsa ekran görüntüsü).

## 5. Google AI Studio (Gemini)

1. https://aistudio.google.com → Google hesabınla gir → **Get API key → Create API key**.
   **Faturalandırma (billing) açma**; açarsan ücretsiz katmandan çıkılır (K-0.2).
2. GitHub secret: `GEMINI_API_KEY`.
3. AI Studio'da **Usage / Rate limits** sayfasındaki model limitlerini bana söyle (ekran görüntüsü yeterli);
   `settings.llm.quotas` değerlerini gerçek limitlere göre güncelleyeceğim (V-25).

## 6. Groq

1. https://console.groq.com → kayıt → **API Keys → Create API Key**. Kart istenirse dur.
2. GitHub secret: `GROQ_API_KEY`.
3. **Settings → Limits** sayfasının ekran görüntüsünü at (Whisper ve sohbet modelleri).

## 7. Telegram botu

1. Telegram'da **@BotFather** → `/newbot` → ad: `Papi`, kullanıcı adı: `..._bot` ile biten benzersiz bir ad.
2. Verilen token → GitHub secret `TELEGRAM_BOT_TOKEN`.
3. Kendi kullanıcı kimliğini öğren: **@userinfobot**'a herhangi bir mesaj at, verdiği sayıyı
   GitHub secret `TELEGRAM_OWNER_ID` olarak ekle.
4. Rastgele bir webhook şifresi üret (en az 32 karakter; şifre yöneticisinin üreticisi olur) →
   GitHub secret `TELEGRAM_WEBHOOK_SECRET`.

## 8. Cloudflare Worker (API + Telegram + zamanlayıcı)

1. Cloudflare → sağ üst profil → **My Profile → API Tokens → Create Token → "Edit Cloudflare Workers"** şablonu.
   Hesap: kendi hesabın. Oluşan token → GitHub secret `CLOUDFLARE_API_TOKEN`.
2. Cloudflare ana sayfasında sağ taraftaki **Account ID** → GitHub secret `CLOUDFLARE_ACCOUNT_ID`.
3. Supabase → **Project Settings → API Keys**:
   - Proje adresi `https://rumwebxglpdvssxlhize.supabase.co` → GitHub secret `SUPABASE_URL`
   - **Secret key** (eski adıyla service_role) → GitHub secret `SUPABASE_SERVICE_ROLE_KEY`.
     Bu anahtar yalnızca sunucuda kullanılır; panele asla konmaz.
4. Bana haber ver: **API deploy** iş akışını çalıştırırım. Worker yayınlanır, secret'lar Worker'a aktarılır ve
   Telegram webhook'u kurulur. Sonra bota sesli not atıp Faz 1 kabul testini birlikte yaparız.

## 9. Instagram (isteğe bağlı)

Instagram linklerinden işletme bilgisi (site, biyografi) çekmek için. Olmadan da Papi çalışır; Instagram linki
gelince "site linki gönder" der.

1. Instagram hesabın **İşletme** veya **İçerik üreticisi** hesabı olmalı ve bir Facebook sayfasına bağlı olmalı.
2. https://developers.facebook.com → **Uygulama oluştur** → tür: İşletme. Kart istenirse dur.
3. Uygulamaya **Instagram Graph API** ürününü ekle; Graph API Explorer'da `instagram_basic` ve
   `pages_show_list` izinleriyle uzun ömürlü bir erişim anahtarı al.
4. GitHub secrets: `IG_ACCESS_TOKEN` (anahtar), `IG_BUSINESS_ACCOUNT_ID` (Instagram işletme hesabının sayısal kimliği).
   Bu adımı birlikte, ekranda yaparız; Meta'nın arayüzü sık değişiyor.

## 10. PageSpeed Insights anahtarı

Anahtarsız da çalışır ama çok kısıtlıdır.

1. https://console.cloud.google.com → yeni proje `papi` (faturalandırma **açma**).
2. **APIs & Services → Library → PageSpeed Insights API → Enable**.
3. **Credentials → Create credentials → API key** → anahtarı yalnızca PageSpeed Insights API ile kısıtla.
4. GitHub secret: `PAGESPEED_API_KEY`.

## Anında ağır iş tetikleme (isteğe bağlı)

Ağır işler (Playwright derin tarama, CSV/OSM/web araması) normalde 6 saatte bir çalışır. Anında çalışsın istersen:

1. GitHub → **Settings → Developer settings → Fine-grained tokens → Generate new token**; Repository access:
   yalnızca `Timurhane/papios`; Permissions → **Actions: Read and write**. Süre: 90 gün.
2. GitHub secret: `GITHUB_DISPATCH_TOKEN` (repo adı deploy sırasında otomatik eklenir).

## 11–12. İleriki fazlar

Bu adımlar ilgili faz başlarken tek tek, aynı ayrıntıda verilecek.
