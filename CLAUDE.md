# CLAUDE.md — Papi (AJNA Digital Ajans İşletim Sistemi)

Bu dosya, bu repoda çalışan her Claude Code oturumunun ilk okuması gereken özettir.
Ayrıntılı ve bağlayıcı kararlar: `docs/decisions.md`. Mimari: `docs/architecture.md`. İlerleme: `docs/roadmap.md`.

## Proje özeti

**Papi**, AJNA Digital'in yapay zeka destekli ajans işletim sistemidir: aday bulur, analiz eder, puanlar,
kişiye özel mesaj yazar, çok kanallı takip dizilerini (playbook) yürütür, gelen cevapları yönetir, teklif ve
demo hazırlar, kazanılan müşterilerin kurulum/operasyonunu takip eder, AJNA'nın içeriğini üretir.
Tek kullanıcı: Timurhan. İletişim: Telegram (yazı + ses), web panel, canlı sesli konuşma.
Altyapı baştan multi-tenant; şu an tek kiracı: AJNA.

## Değişmez ilkeler (kısa)

1. **Dışarı giden her şey onay kuyruğundan geçer.** Tek istisna: analiz aracını kullanan kişiye giden analiz raporu.
2. **Sıfır maliyet.** Yalnızca ücretsiz ve kart istemeyen servisler. Ücretli/kartlı bir şeyi sessizce ekleme; dur ve sor.
   Bir limite güvenmeden önce resmi dokümandan doğrula ve `docs/free-tier-limits.md`'ye kaynak linkiyle yaz.
3. **Önce kural, sonra model.** Kodla cevaplanabilen şey için LLM çağrılmaz. Önbellek, toplu işleme, şablon + kişisel kısım.
4. **Sağlayıcıdan bağımsız beyin.** Tüm LLM erişimi `LLMProvider` arayüzünden; sağlayıcı değişimi = ayar değişikliği.
5. **Ücretsiz katman gizlilik kuralı.** Kazanılmış müşterinin hassas verisi ve kişisel veriler ücretsiz katman modellerine gönderilmez.
   Kodda veri sınıflandırması ile zorunlu kılınır.
6. **Hiçbir CRM kaydı sıradaki adımsız durmaz** (playbook / bekleme nedeni + tarih / kapalı).
7. **Her eylem audit log'a yazılır** (ne, ne zaman, hangi ajan, kim onayladı, model, token, kota).
8. **Global reddedenler listesi** her mesaj üretim/gönderim yolunda zorunlu kontrol edilir ve testle korunur.
9. **Kararları sorgulama, değiştirme.** Teknik engel varsa dur, nedenini ve alternatifleri yaz, onay bekle.
   Varsayımlar `docs/decisions.md` → "Varsayımlar" bölümüne yazılır ve faz sonunda listelenir.

## Çalışma düzeni

- Fazlar `docs/roadmap.md` sırasıyla ilerler. Her faz sonunda: çalışan demo, yeşil testler, roadmap güncel,
  özet, Timurhan'ın "devam" onayı. Onaysız sonraki faza geçilmez.
- Hesap açma, API anahtarı, OAuth uygulaması: **Timurhan yapar.** Sen adım adım talimat yazar ve beklersin.
- Gizli bilgi (şifre, anahtar, token) asla koda/repoya girmez. Yerler: Cloudflare secrets, GitHub Actions secrets,
  Supabase vault, yerelde git'e girmeyen `.env`. `.env.example` her zaman güncel.
- Küçük, mantıklı commit'ler. Testsiz modül tamamlanmış sayılmaz.

## Dil kuralları

- Arayüz metinleri, Papi'nin tüm mesajları, prompt çıktıları: **Türkçe**.
- Kod, değişken/fonksiyon adları, commit mesajları, kod yorumları: **İngilizce**.
- `docs/` belgeleri: Türkçe (teknik terimler İngilizce kalabilir).

## Teknoloji

TypeScript her yerde · pnpm workspaces · Cloudflare Workers (Hono) + Cron Triggers · Cloudflare Pages
(React + Vite + Tailwind + shadcn/ui) · Supabase (Postgres, Auth, Storage, pgvector) · GitHub Actions
(Node + Playwright; ağır işler) · Gemini (birincil) / Groq (yedek) / Anthropic (kapalı adaptör) ·
Groq Whisper (STT) · TTS adaptörü · Gemini Live (canlı ses) · Leaflet + OSM · Turnstile · Vitest.

## Klasör yapısı

```
apps/
  api/        # Cloudflare Worker: REST, Telegram webhook, cron, analiz aracı, demo sayfaları, çıkış linki
  web/        # Panel (Cloudflare Pages)
  jobs/       # GitHub Actions scriptleri: crawler, toplu analiz, yedek
packages/
  core/       # tipler, db istemcisi, LLM katmanı, ajanlar, araçlar, puanlama, playbook motoru, kuyruk
  prompts/    # ajan ve görev promptları (versiyonlu)
  modules/    # müşteriye teslim edilen otomasyon modülü şablonları
supabase/
  migrations/ seed/ policies/ tests/
docs/
.github/workflows/
```

## Komutlar

> Faz 0 tamamlanınca geçerli olur.

```bash
pnpm install              # bağımlılıklar
pnpm lint                 # ESLint (tüm workspace)
pnpm format               # Prettier yaz / pnpm format:check
pnpm typecheck            # tsc --noEmit (tüm workspace)
pnpm test                 # Vitest (birim testleri)
pnpm test:db              # Supabase yerel + RLS/pgTAP testleri (Docker gerekir)
pnpm --filter web dev     # panel geliştirme sunucusu
pnpm --filter api dev     # wrangler dev
supabase db reset         # migration + seed'i yerelde baştan uygula
```

## Kod kuralları

- TypeScript `strict`. `any` yasak (gerekirse `unknown` + daraltma). Dış girdiler Zod ile doğrulanır.
- Her tabloda `tenant_id`; RLS her tabloda açık. Servis anahtarı (`service_role`) yalnızca sunucu tarafında.
- Dışarı mesaj üreten/gönderen her fonksiyon: (1) reddedenler listesi kontrolü, (2) onay durumu kontrolü,
  (3) audit log kaydı yapar. Bu kontroller merkezi bir koruma katmanındadır, atlanamaz.
- LLM çağrıları doğrudan SDK ile yapılmaz; `packages/core/llm` üzerinden geçer (yönlendirme, kota, önbellek,
  sınıflandırma, `llm_calls` kaydı).
- Promptlar kod içine gömülmez; `packages/prompts` altında versiyonlu dosyalardadır.
- Ayarlanabilir her değer (limitler, eşikler, saatler, fiyatlar) koda sabitlenmez; `settings` tablosundan okunur,
  seed'de varsayılanı vardır.
- Para birimleri tam sayı kuruş (veya TL tam sayı) olarak saklanır; float yok.
- Zaman: veritabanında `timestamptz` (UTC); iş saati hesapları `Europe/Istanbul`.
