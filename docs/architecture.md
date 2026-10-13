# Mimari

> Bu belge yaşayan bir belgedir; her faz sonunda güncellenir. Bağlayıcı kararlar `docs/decisions.md`'dedir.

## 1. Genel görünüm

```
                    ┌─────────────────────────┐
  Timurhan ──────── │ Telegram (yazı/ses)     │──┐ webhook (gizli token)
     │              └─────────────────────────┘  │
     │              ┌─────────────────────────┐  ▼
     ├─ tarayıcı ── │ apps/web (CF Pages)     │──► apps/api (CF Worker, Hono)
     │              │ React+Vite+Tailwind     │     ├─ REST (JWT + TOTP AAL2)
     │              └──────────┬──────────────┘     ├─ /telegram/webhook
     │                         │ Gemini Live        ├─ /public/* (analiz aracı, çıkış, demo)
     │                         ▼ (ephemeral token)  ├─ cron: her dakika kuyruk dağıtıcı
     │                    Gemini Live API           └─ ajan döngüsü (packages/core)
     │                                                     │
     │                                                     ▼
     │                         ┌──────────────────────────────────────────┐
     │                         │ Supabase: Postgres + RLS + pgvector,     │
     │                         │ Auth (TOTP), Storage, Vault              │
     │                         └──────────────────────────────────────────┘
     │                                   ▲            ▲
     │                                   │            │ service role (yalnızca sunucu)
     │                         ┌─────────┴────────┐   │
     │                         │ GitHub Actions   │───┘
     │                         │ apps/jobs:       │  Playwright tarama, toplu analiz,
     │                         │                  │  PageSpeed, gece yedeği (pg_dump+şifre)
     │                         └──────────────────┘
     │
     └─ Dış LLM: Gemini (birincil) · Groq (yedek, Whisper) · Anthropic (kapalı)
```

## 2. Uygulamalar ve paketler

| Yol                | Sorumluluk                                                                                                                                         | Çalıştığı yer                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `apps/api`         | Hono REST API, Telegram webhook, cron kuyruk dağıtıcısı, herkese açık uçlar (analiz aracı, çıkış linki, `/demo/{token}`)                           | Cloudflare Workers                               |
| `apps/web`         | Panel (18 modül), giriş + TOTP, "Papi ile konuş"                                                                                                   | Cloudflare Pages                                 |
| `apps/jobs`        | Ağır işler: Playwright site tarayıcı, toplu analiz, PageSpeed, yedek, veri saklama temizliği                                                       | GitHub Actions                                   |
| `packages/core`    | Tipler, Zod şemaları, db istemcisi, LLM katmanı, ajan döngüsü, araçlar, puanlama, playbook motoru, kuyruk, koruma katmanı (reddedenler/onay/audit) | Her yerde (Worker uyumlu, Node API'si kullanmaz) |
| `packages/prompts` | Ajan ve görev promptları, versiyonlu                                                                                                               | Her yerde                                        |
| `packages/modules` | Müşteriye teslim modül şablonları (README, JSON Schema, rehber, test listesi)                                                                      | —                                                |
| `supabase/`        | Migration, seed, RLS politikaları, pgTAP testleri                                                                                                  | Supabase                                         |

`packages/core` Workers runtime'ında da çalışacağı için yalnızca Web standart API'leri (fetch, crypto.subtle) kullanır.
Node'a özel kod `apps/jobs` içinde kalır.

## 3. Veri modeli (çekirdek)

Tüm tablolarda `id uuid`, `tenant_id uuid not null`, `created_at`, `updated_at`. RLS politikası:
`tenant_id = (select app.current_tenant_id())` — kiracı, JWT'deki kullanıcının `tenant_members` kaydından çözülür.

Faz 0'da kurulacak temel tablolar:

- `tenants`, `tenant_members` (kullanıcı ↔ kiracı, rol)
- `settings` (anahtar/değer, JSON; tüm ayarlanabilir değerler)
- `feature_flags` (ör. `client_portal = false`)
- `packages` (paket ve fiyatlar), `founder_discount` sayacı
- `playbooks`, `playbook_steps`
- `audit_log` (yalnızca ekleme; UPDATE/DELETE trigger ile engellenir)
- `suppression_list` (global reddedenler; kiracı bazlı ama tüm kanalları kapsar)
- `jobs` (kuyruk)
- `knowledge_items` (bilgi bankası; `embedding vector` sütunu Faz 1'de doldurulur)
- `tone_profile`, `banned_phrases`

Sonraki fazlarda: `companies`, `contacts`, `analyses`, `scores`, `touches`, `drafts`, `approvals`, `messages`,
`inbox_items`, `llm_calls`, `llm_cache`, `quota_usage`, `proposals`, `demos`, `projects`, `tasks`, `finance_*`,
`notes`, `routines`, `content_items`, `style_memory`, `signals`.

## 4. Kimlik doğrulama ve yetki

- Supabase Auth, e-posta + şifre; **kayıt kapalı** (Auth ayarı + izinli e-posta kontrolü).
- TOTP MFA zorunlu: panel, oturumun `aal2` seviyesinde olmasını şart koşar; RLS politikaları da
  `auth.jwt()->>'aal' = 'aal2'` koşulunu içerir (MFA'sız token ile veri okunamaz).
- Worker, kullanıcı isteklerinde kullanıcının JWT'sini Supabase'e iletir (RLS geçerli kalır).
  Arka plan işleri (cron, Actions) `service_role` ile çalışır ve her sorguda `tenant_id`'yi açıkça verir.
- Herkese açık uçlar ayrı bir dar yetki yoluyla çalışır: yalnızca kendi işine özel fonksiyonları
  (ör. `public_submit_analysis_request`) çağırabilir, genel tablolara erişemez.

## 5. Kuyruk ve zamanlama

- `jobs` tablosu: `type`, `payload jsonb`, `status (queued|running|done|failed|dead)`, `run_after`,
  `attempts`, `max_attempts`, `locked_at`, `locked_by`, `last_error`.
- Kilitleme: `select ... for update skip locked` (RPC fonksiyonu ile).
- Worker cron (her dakika): kısa işleri alır ve işler; ağır işleri `heavy` olarak işaretler.
- GitHub Actions: zamanlanmış iş + `workflow_dispatch`; `heavy` işleri toplu çeker. Dakika kotasına göre zamanlama
  `docs/free-tier-limits.md`'deki hesapla belirlenir.

## 6. LLM katmanı (Faz 1)

```
task(level, dataClass) → router → quota/rate limiter → cache(hash) → provider adapter → llm_calls
```

- `dataClass`: `public | internal | personal | client_sensitive`. Ücretsiz katman sağlayıcıları yalnızca
  `public | internal` kabul eder; diğerleri için çağrı reddedilir (hata, sessiz düşüş değil).
- Yedeğe geçiş: kota sınırı veya 429 → Groq; ikisi de doluysa iş `run_after` ile ertelenir.

## 7. Dışarı giden mesaj koruma katmanı

Her giden mesaj tek bir `outbound.guard()` fonksiyonundan geçer:

1. Alıcı/firma `suppression_list`'te mi? → kesin red.
2. Onay var mı? (analiz aracı raporu istisnası açık tür adıyla)
3. İş saati / haftalık temas sınırı / günlük limit + ısınma.
4. Kanal kuralları (soğuk mail ≤ 80 kelime, çıkış linki).
5. `audit_log` kaydı.
   Bu kontroller testlerle korunur; guard dışında gönderim yapan kod yazılmaz.

## 8. Ortamlar

| Ortam | Supabase                             | Worker         | Panel  |
| ----- | ------------------------------------ | -------------- | ------ |
| Yerel | `supabase start` (Docker)            | `wrangler dev` | `vite` |
| CI    | `supabase start` (Actions'ta Docker) | testler        | build  |
| Canlı | Supabase ücretsiz proje              | Workers        | Pages  |

Not: Ücretsiz Supabase'de ayrı staging projesi açılabilir (proje sayısı limiti doğrulanacak); başlangıçta yalnızca canlı + yerel.
