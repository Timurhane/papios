# Yol haritası

Her faz sonunda: çalışan demo, testler yeşil, bu dosya güncel, Timurhan'a özet, **"devam" onayı**.
Durum: ⬜ yapılmadı · ✅ tamam. Kaynak: talimat Bölüm 18.

## Faz 0 — Temel

- [x] Monorepo (pnpm workspaces), TypeScript, ESLint, Prettier, Vitest
- [x] CI: GitHub Actions'ta lint + typecheck + test + RLS testleri
- [x] Gizli bilgi taraması (gitleaks, pre-commit + CI)
- [x] Hesap ve anahtar kontrol listesi yazıldı (`docs/setup/accounts.md`)
- [x] Supabase projesi açıldı (ref `rumwebxglpdvssxlhize`), PR #1 `main`'e birleşti
- [ ] **Ertelendi → toplu canlı kurulum oturumu (bilgisayar başında):** GitHub secrets, DB deploy, panel kullanıcısı, Cloudflare Pages
- [ ] Canlıda giriş + TOTP denendi
- [x] `docs/free-tier-limits.md` (resmi kaynak linkli)
- [x] Supabase şeması: multi-tenant, RLS, migration
- [x] Seed: AJNA kiracısı, paketler, playbook seti, varsayılan ayarlar, marka bilgisi
- [x] Panel iskeleti (Türkçe, siyah + mor-mavi tema, mobil) + giriş + zorunlu TOTP
- [x] Worker iskeleti (Hono, sağlık ucu)
- [ ] **Kabul:** Giriş çalışıyor (yerelde testli; canlı bekliyor) · ✅ RLS testleri başka kiracı verisinin okunamadığını kanıtlıyor · ✅ CI yeşil

## Toplu canlı kurulum oturumu

Mobilde GitHub Settings açılamadığı için canlı kurulum tek oturuma toplandı (`docs/setup/accounts.md` sırasıyla).
En geç Faz 1 kabulünden önce yapılmalı; Faz 1 kabulü canlı Worker + Telegram gerektirir.

## Faz 1 — Beyin ve Telegram

- [x] LLM katmanı: Gemini, Groq, kapalı Anthropic; seviye yönlendirme; rate limiter; önbellek; `llm_calls`
- [x] Veri sınıflandırma kuralı (ücretsiz katman gizliliği)
- [x] İş kuyruğu + Worker cron
- [x] Telegram botu: kimlik beyaz listesi, yazı, sesli not (Whisper), onay butonları, komutlar
- [x] Bilgi bankası, firma hafızası, stil hafızası; gömme ve arama
- [x] Papi ajan döngüsü ve temel araçlar
- [x] Hata kaydı (`error_events`), model doğrulama işi, API deploy iş akışı
- [ ] **Kabul:** Telegram sesli not → Papi anlıyor, bilgi bankasından cevaplıyor (testli; canlı bekliyor) · ✅ kota sınırında yedeğe geçiş (testli) · ✅ yabancı kullanıcı yok sayılıyor (testli; canlı bekliyor)

## Faz 2 — Aday ve analiz

- [x] CRM veri modeli ve ekranları (liste, kanban, firma kartı), mükerrer kontrolü
- [x] Kaşif: grounding araması, OSM, CSV, Telegram link, Instagram business discovery, kapalı Places adaptörü
- [x] Analist: Actions'ta Playwright, PageSpeed, kural tabanlı kontroller, model analizi, puan + gerekçe
- [x] Bugün ekranı (ilk hali)
- [x] Papi araçları: isimle aday ekleme, CRM'de arama, web/OSM araması başlatma
- [ ] **Kabul:** Telegram'a atılan link 5 dk içinde puanlı ve analizli firma kartı (testli: tek cron turunda; canlı bekliyor)

## Faz 3 — Ulaşma

- [ ] Mail altyapısı kararı (A-1) onaylandı
- [x] Playbook motoru + seed set, Ulak
- [ ] Mail gönderim/okuma (A-1 bekliyor) — ısınma, limitler, iş saati zamanlaması ve `MailTransport` hazır
- [x] Tek tık kuyruğu (WhatsApp, Instagram, LinkedIn, X) — Telegram + panel
- [x] Reddedenler listesi + çıkış linki (zorunlu testler)
- [x] Gelen kutusu, cevap sınıflandırma, cevapta dizinin durması
- [x] Panel: Gelen kutusu, Playbook'lar (adım performansı), panelden onay/düzenleme, Bugün'de tek tık ve aramalar
- [ ] **Kabul:** Aday Soğuk Ana'ya giriyor · onaylı mail iş saatinde gidiyor · cevapta dizi duruyor · "yazmayın" diyen hiçbir yoldan mesaj alamıyor

## Faz 4 — Satış

- [x] Satıcı: cevap taslakları (ayıklanmış girdiyle), görüşme saati önerisi (Google Takvim bağlanınca dolu saatleri atlar), hazırlık notu, görüşme notundan teklif taslağı
- [x] Teklif stüdyosu + PDF (tarayıcıda), iki ödeme yolu, kurucu indirimi sayacı (veritabanında aşılamaz), Özel proje fiyatlama
- [x] Kişiye özel demo sayfaları (14 gün, Turnstile, günlük sınırlar), Soğuk Ana demo adımı
- [ ] Canlı: Google Takvim + Turnstile + Worker adresi kurulumu (masaüstü oturumu)
- [ ] **Kabul:** Sesli görüşme notundan teklif taslağı ve PDF · demo linki çalışıyor ve 14 gün sonra kapanıyor

## Faz 5 — Operasyon

- [x] Projeler, Finans (MRR, tahsilat, gecikme bildirimi, gelir-gider), Notlar
- [x] Teslim modülleri (5 modül: README, SETUP, TESTS, şema), kurulum formu (müşteri linki), Claude Code promptu, kontrol listesi; cevap asistanı referans implementasyonu
- [x] Müşteri Yaşamı ve Referans playbook'ları, aylık müşteri raporu (modül sayıları → şablon → onay)
- [ ] Canlı: kurulum formu ve modül uç noktası (Worker adresi + Turnstile, masaüstü oturumu)
- [ ] **Kabul:** Kazanıldı işaretlenen firma için proje + kurulum formu + Claude Code promptu oluşuyor

## Faz 6 — Zeka ve otomasyon

- [x] Rutinler (hazır + doğal dille), gece vardiyası ve uyku modu
- [x] Sinyal motoru, Kalem, haftalık patron özeti, öğrenen sistem önerileri
- [x] Ölçütler ekranı, harita ve ziyaret rotası
- [x] Notların anlam araması Papi'nin araçlarında (`search_notes`)
- [x] **Kabul (kod + testler):** `/uyuyorum` sonrası vardiya çalışıyor, `/uyandim` ile özet geliyor; rutinler
      zamanında çalışıyor (`apps/api/src/automation.test.ts`). Canlı kabul masaüstü kurulum oturumunda.

## Faz 7 — Dış yüz ve sertleştirme

- [ ] Analiz aracı (Turnstile, KVKK onayı, onaysız rapor, Sıcak Gelen) + siteye ekleme rehberi
- [ ] Canlı sesli konuşma
- [ ] Müşteri portalı (kapalı bayrak)
- [ ] Gece yedeği + geri yükleme testi, gizli bilgi taraması, güvenlik gözden geçirmesi, veri saklama/silme
- [ ] `SUPABASE_ACCESS_TOKEN` dar yetkili token ile değiştirildi (V-23)
- [ ] Uçtan uca senaryo testi
- [ ] Teslim dokümanları (Bölüm 19)
- [ ] **Kabul:** Uçtan uca senaryo geçiyor · yedek geri yükleniyor · ücretsiz limitler içinde kalındığı ölçütlerde görülüyor
