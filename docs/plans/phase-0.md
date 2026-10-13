# Faz 0 planı — Temel

Durum: **Onay bekliyor.**
Hedef (kabul): Giriş çalışıyor · RLS testleri başka kiracı verisinin okunamadığını kanıtlıyor · CI yeşil.

## Adımlar (her biri ayrı commit)

### 0.1 Monorepo iskeleti
- Kök: `package.json` (pnpm workspaces), `pnpm-workspace.yaml`, `tsconfig.base.json` (strict), `.nvmrc` (Node 22),
  `.editorconfig`, `.gitignore`, `.env.example`.
- ESLint (flat config, typescript-eslint), Prettier, Vitest (workspace modu).
- Boş ama derlenen paketler: `apps/api`, `apps/web`, `apps/jobs`, `packages/core`, `packages/prompts`, `packages/modules`.
- Kök scriptler: `lint`, `format`, `format:check`, `typecheck`, `test`, `test:db`, `build`.

### 0.2 Gizli bilgi koruması
- `gitleaks` yapılandırması (`.gitleaks.toml`), `lefthook` ile pre-commit kancası (gitleaks + lint-staged).
- CI'da da gitleaks taraması (yerel kancayı atlayan commit'ler için ikinci kilit).

### 0.3 CI (GitHub Actions)
- `ci.yml`: install (pnpm cache) → lint → format:check → typecheck → test → `supabase start` + migration + pgTAP/RLS testleri → web build.
- Yalnızca push/PR'da çalışır; dakika tüketimi ölçülüp `free-tier-limits.md`'ye işlenir.

### 0.4 `docs/free-tier-limits.md`
Resmi dokümandan doğrulanıp kaynak linkiyle yazılacaklar: Cloudflare Workers (istek/gün, CPU ms, cron sayısı,
subrequest), Pages (build/ay), Turnstile; Supabase (DB boyutu, storage, MAU, proje sayısı, **hareketsizlikte duraklatma**,
Edge/egress, yedek yok); GitHub Actions (özel/herkese açık repo dakikaları, artifact saklama); Gemini (model başına
RPM/RPD/TPM, grounding, embedding, Live API, TTS, **ücretsiz katman veri kullanımı**); Groq (LLM + Whisper limitleri);
ElevenLabs ücretsiz; Sentry ücretsiz (kart?); PageSpeed Insights API; Overpass API kullanım politikası;
Telegram Bot API; Instagram Graph API.
Bir servisin kart istediği/limitin yetmediği görülürse burada durup alternatif sunarım.

### 0.5 Supabase şeması (migration'lar)
- Uzantılar: `pgcrypto`, `vector`.
- Şema `app`: `current_tenant_id()`, `is_aal2()` yardımcı fonksiyonları.
- Tablolar: `tenants`, `tenant_members`, `settings`, `feature_flags`, `packages`, `founder_discount`,
  `playbooks`, `playbook_steps`, `knowledge_items` (embedding sütunu boş), `tone_profiles`, `banned_phrases`,
  `suppression_list`, `audit_log` (yalnızca ekleme — UPDATE/DELETE engelli), `jobs`.
- RLS her tabloda açık; politika: kiracı eşleşmesi **ve** `aal2`. `anon` rolüne hiçbir tabloda yetki yok.
- `jobs` için `claim_jobs()` RPC (`for update skip locked`) — gövdesi Faz 1'de genişler.

### 0.6 Seed
- AJNA kiracısı + marka bilgisi (bilgi bankası maddeleri), boş ton profili, boş yasaklı ifadeler.
- Paketler ve iki ödeme yolu parametreleri, kurucu indirimi sayacı (0/3), KDV = "belirtilmedi".
- 10 playbook ve adımları (talimat Bölüm 11).
- Varsayılan ayarlar: iş saatleri, günlük mail limiti 20 + ısınma, haftalık 2 temas, puanlama ağırlıkları/eşikler,
  bölge önceliği, LLM yönlendirme ve kota alanları, veri saklama 12 ay, bildirim tercihleri, `client_portal=false`.
- Test için ikinci kiracı **yalnızca test fixture'ında** (canlı seed'de değil).

### 0.7 RLS testleri
- pgTAP: kiracı A kullanıcısı kiracı B satırlarını okuyamaz/yazamaz/silemez; `aal1` token hiçbir satır göremez;
  `anon` hiçbir şey göremez; `audit_log` güncellenemez/silinemez.
- Vitest entegrasyon testi: supabase-js ile gerçek oturum üzerinden aynı kontroller.

### 0.8 Worker iskeleti (`apps/api`)
- Hono, `GET /health`, ortam değişkeni şeması (Zod), `wrangler.toml` (secret değerleri yok), Vitest testi.

### 0.9 Panel iskeleti (`apps/web`)
- React + Vite + Tailwind + shadcn/ui; tema: siyah zemin, mor-mavi parıltı vurguları; logo yer tutucu.
- Türkçe metinler tek dosyada (`i18n/tr.ts`).
- Akış: Giriş (e-posta + şifre) → TOTP yoksa **zorunlu kayıt** (QR) → TOTP doğrulama → panel.
  `aal2` olmayan oturum panel rotalarına giremez.
- Kayıt ekranı yok; Supabase Auth'ta kayıt kapalı; izin verilen tek e-posta ayardan/env'den.
- Mobil uyumlu kabuk: kenar menü (masaüstü) / alt menü (mobil), 18 modül için boş sayfalar ("Yakında").
- Testler: giriş korumaları (Vitest + Testing Library), Playwright ile duman testi (yerel Supabase'e karşı).

### 0.10 Hesap ve anahtar kontrol listesi — `docs/setup/accounts.md`
Senin yapacağın adımlar, adım adım (ekran ekran), hangi değeri nereye koyacağın ile:
1. GitHub: repo görünürlüğü kararı (A-4), Actions secrets ekleme.
2. Supabase: proje (bölge: Frankfurt `eu-central-1`), Auth'ta kayıtları kapat, MFA (TOTP) açık, kullanıcıyı davet et; URL/anon/service anahtarları.
3. Cloudflare: hesap, Workers + Pages, API token (dar yetkili), Turnstile site anahtarı (Faz 7'de kullanılacak).
4. Google AI Studio: Gemini API anahtarı.
5. Groq: API anahtarı.
6. Telegram: BotFather ile bot, token; kendi kullanıcı kimliğini öğrenme.
7. Meta geliştirici uygulaması + Instagram işletme hesabı bağlantısı (Faz 2'de lazım; şimdi başlanabilir, onay süreçleri uzun sürebilir).
8. Natro: SMTP/IMAP sunucu, port, kullanıcı bilgileri (yalnızca A-1 kararı için; şifre bana değil, kasaya).

## Faz 0'da yapılmayacaklar
LLM çağrıları, Telegram botu, kuyruk işleyicisi, CRM tabloları (Faz 1–2).

## Senden ihtiyacım olanlar (onayla birlikte)
1. Bu planın onayı.
2. **A-4:** GitHub reposu özel mi kalacak, herkese açık mı olabilir? (Özelde Actions dakikası sınırlı, herkese açıkta sınırsız ama kod görünür; sırlar her iki durumda da repoda değil.)
3. Panelde giriş yapacak tek e-posta adresi (`.env`/ayar için; repoya yazılmaz).
4. Supabase bölgesi için Frankfurt uygun mu?
