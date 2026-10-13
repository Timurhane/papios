# Kurulum ve yeniden kurulum (K-19.1)

Bu belge sistemi sıfırdan (ya da başka bir hesaba) kurmanın sırasını verir. Her adımın ayrıntısı
`docs/setup/accounts.md`'de. Gizli değerler yalnızca kasalara girer: GitHub Actions secrets, Cloudflare secrets,
yerelde git'e girmeyen `.env` / `apps/api/.dev.vars`.

## Sıra

1. **Repo:** GitHub'da özel repo (K-17.8). `pnpm install`, `pnpm test` yerelde yeşil olmalı.
2. **Supabase:** proje aç → `supabase link` → `supabase db push` (migration) → seed: `supabase db reset` yerine
   canlıda `db-deploy.yml` iş akışı (migration; ilk kurulumda "include_seed" işaretli). Auth → kayıt kapalı, TOTP açık.
3. **Panel kullanıcısı:** Auth → kullanıcı ekle (tek mail) → `tenant_members` satırı (accounts.md §3).
4. **Cloudflare Pages:** panel (`apps/web`), ortam değişkenleri `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`,
   `VITE_ALLOWED_EMAIL`, `VITE_API_URL`. `_headers` ve `_redirects` repoda.
5. **Yapay zeka:** Gemini (birincil), Groq (yedek) anahtarları → GitHub secrets.
6. **Telegram:** BotFather → bot; senin kullanıcı kimliğin → `TELEGRAM_OWNER_ID`; webhook gizli anahtarı.
7. **Worker:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` → `api-deploy.yml` çalışır, secrets'ı aktarır,
   Telegram webhook'unu kurar. Değişkenler (Variables): `PANEL_URL`, `PUBLIC_API_URL`, `ANALYSIS_EMBED_ORIGINS`.
8. **Genel adres ve imza anahtarı:** `PUBLIC_TOKEN_SECRET` (≥ 32 karakter, rastgele).
9. **Turnstile:** site anahtarı; alan adlarına Worker ve AJNA sitesi eklenir.
10. **İsteğe bağlı:** PageSpeed anahtarı, Instagram, Google Takvim, `GITHUB_DISPATCH_TOKEN`.
11. **Mail (A-1 kararından sonra):** bağlanınca ulaşma, gelen kutusu ve analiz raporu e-postası açılır.
12. **Yedek:** `docs/yedekten-geri-yukleme.md` → "Bir kerelik kurulum".
13. **Analiz aracı:** `docs/analiz-araci-ekleme.md`.

## Kontrol listesi (canlı kabul)

- [ ] `GET <worker>/health` → `missing: []`
- [ ] Telegram'da `/bugun` cevap veriyor; yabancı hesaptan yazınca cevap yok
- [ ] Panel girişi mail + şifre + TOTP; başka mail giremiyor
- [ ] `/ekle <site>` → 1–2 dakikada analiz kartı
- [ ] Bir taslak onaylanınca iş saatinde gönderiliyor (mail bağlıysa)
- [ ] `/uyuyorum` → `/uyandim` özeti
- [ ] `/analiz` formu → rapor sayfası → Telegram'da "Sıcak Gelen"
- [ ] "Papi ile konuş" bağlanıyor, kalan süre görünüyor
- [ ] Nightly backup elle çalıştırıldı, geri yükleme testi yeşil
- [ ] Ölçütler → Ücretsiz limitler makul değerler gösteriyor

## Yeniden kurulum (başka hesap / felaket)

Yeni Supabase projesi + `supabase db push` + yedekten veri (`docs/yedekten-geri-yukleme.md`), ardından yukarıdaki
4–13. adımlar. Kod ve şema repoda olduğu için yalnızca anahtarlar ve veri taşınır.
