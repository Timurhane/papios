# Yol haritası

Her faz sonunda: çalışan demo, testler yeşil, bu dosya güncel, Timurhan'a özet, **"devam" onayı**.
Durum: ⬜ yapılmadı · ✅ tamam. Kaynak: talimat Bölüm 18.

## Faz 0 — Temel

- [x] Monorepo (pnpm workspaces), TypeScript, ESLint, Prettier, Vitest
- [x] CI: GitHub Actions'ta lint + typecheck + test + RLS testleri
- [x] Gizli bilgi taraması (gitleaks, pre-commit + CI)
- [x] Hesap ve anahtar kontrol listesi yazıldı (`docs/setup/accounts.md`)
- [ ] Faz 0 hesapları açıldı: Supabase, GitHub secrets, panel kullanıcısı, Cloudflare Pages
- [ ] Canlıda giriş + TOTP denendi
- [x] `docs/free-tier-limits.md` (resmi kaynak linkli)
- [x] Supabase şeması: multi-tenant, RLS, migration
- [x] Seed: AJNA kiracısı, paketler, playbook seti, varsayılan ayarlar, marka bilgisi
- [x] Panel iskeleti (Türkçe, siyah + mor-mavi tema, mobil) + giriş + zorunlu TOTP
- [x] Worker iskeleti (Hono, sağlık ucu)
- [ ] **Kabul:** Giriş çalışıyor (yerelde testli; canlı bekliyor) · ✅ RLS testleri başka kiracı verisinin okunamadığını kanıtlıyor · ✅ CI yeşil

## Faz 1 — Beyin ve Telegram

- [ ] LLM katmanı: Gemini, Groq, kapalı Anthropic; seviye yönlendirme; rate limiter; önbellek; `llm_calls`
- [ ] Veri sınıflandırma kuralı (ücretsiz katman gizliliği)
- [ ] İş kuyruğu + Worker cron
- [ ] Telegram botu: kimlik beyaz listesi, yazı, sesli not (Whisper), onay butonları, komutlar
- [ ] Bilgi bankası, firma hafızası, stil hafızası; gömme ve arama
- [ ] Papi ajan döngüsü ve temel araçlar
- [ ] **Kabul:** Telegram sesli not → Papi anlıyor, bilgi bankasından cevaplıyor · kota sınırında yedeğe geçiş (testli) · yabancı kullanıcı yok sayılıyor

## Faz 2 — Aday ve analiz

- [ ] CRM veri modeli ve ekranları, mükerrer kontrolü
- [ ] Kaşif: grounding araması, OSM, CSV, Telegram link, Instagram business discovery, kapalı Places adaptörü
- [ ] Analist: Actions'ta Playwright, PageSpeed, kural tabanlı kontroller, model analizi, puan + gerekçe
- [ ] Bugün ekranı (ilk hali)
- [ ] **Kabul:** Telegram'a atılan link 5 dk içinde puanlı ve analizli firma kartı

## Faz 3 — Ulaşma

- [ ] Mail altyapısı kararı (A-1) onaylandı
- [ ] Playbook motoru + seed set, Ulak
- [ ] Mail gönderim/okuma, ısınma ve limitler, iş saati zamanlaması
- [ ] Tek tık kuyruğu (WhatsApp, Instagram, LinkedIn, X)
- [ ] Reddedenler listesi + çıkış linki (zorunlu testler)
- [ ] Gelen kutusu, cevap sınıflandırma, cevapta dizinin durması
- [ ] **Kabul:** Aday Soğuk Ana'ya giriyor · onaylı mail iş saatinde gidiyor · cevapta dizi duruyor · "yazmayın" diyen hiçbir yoldan mesaj alamıyor

## Faz 4 — Satış

- [ ] Satıcı: cevap taslakları, Google Takvim görüşme önerisi, görüşme asistanı
- [ ] Teklif stüdyosu + PDF, kurucu indirimi sayacı
- [ ] Kişiye özel demo sayfaları
- [ ] **Kabul:** Sesli görüşme notundan teklif taslağı ve PDF · demo linki çalışıyor ve 14 gün sonra kapanıyor

## Faz 5 — Operasyon

- [ ] Projeler, Finans, Notlar
- [ ] Teslim modülleri, kurulum formu, Claude Code promptu, kontrol listesi; cevap asistanı referans implementasyonu
- [ ] Müşteri Yaşamı ve Referans playbook'ları, aylık müşteri raporu
- [ ] **Kabul:** Kazanıldı işaretlenen firma için proje + kurulum formu + Claude Code promptu oluşuyor

## Faz 6 — Zeka ve otomasyon

- [ ] Rutinler (hazır + doğal dille), gece vardiyası ve uyku modu
- [ ] Sinyal motoru, Kalem, haftalık patron özeti, öğrenen sistem önerileri
- [ ] Ölçütler ekranı, harita ve ziyaret rotası
- [ ] **Kabul:** `/uyuyorum` sonrası vardiya çalışıyor, `/uyandim` ile özet geliyor; rutinler zamanında çalışıyor

## Faz 7 — Dış yüz ve sertleştirme

- [ ] Analiz aracı (Turnstile, KVKK onayı, onaysız rapor, Sıcak Gelen) + siteye ekleme rehberi
- [ ] Canlı sesli konuşma
- [ ] Müşteri portalı (kapalı bayrak)
- [ ] Gece yedeği + geri yükleme testi, gizli bilgi taraması, güvenlik gözden geçirmesi, veri saklama/silme
- [ ] `SUPABASE_ACCESS_TOKEN` dar yetkili token ile değiştirildi (V-23)
- [ ] Uçtan uca senaryo testi
- [ ] Teslim dokümanları (Bölüm 19)
- [ ] **Kabul:** Uçtan uca senaryo geçiyor · yedek geri yükleniyor · ücretsiz limitler içinde kalındığı ölçütlerde görülüyor
