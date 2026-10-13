# Kararlar kaydı

Bu dosya, Timurhan ile planlama sürecinde karara bağlanmış her şeyin **değiştirilemez** kaydıdır.
Bir kararın değişmesi gerekirse eski madde silinmez; altına tarihli "Değişiklik" notu eklenir ve
Timurhan'ın onayı belirtilir. Kaynak: kurulum talimatı (2026-10-13). Bölüm numaraları talimattaki numaralardır.

Biçim: `K-<bölüm>.<sıra>` — karar kimliği. Kod yorumlarında ve PR'larda bu kimliklerle atıf yapılabilir.

---

## Çalışma kuralları (Bölüm 0)

- **K-0.1** Fazlar sırayla yürür; her faz sonunda çalışan demo, yeşil testler, güncel roadmap, özet ve Timurhan'ın "devam" onayı. Onaysız sonraki faza geçilmez.
- **K-0.2** Ücretsizlik kuralı: yalnızca ücretsiz ve kredi kartı istemeyen servisler. Ücretli, kartlı veya deneme süresi biten plan sessizce eklenmez. Limitler resmi dokümandan doğrulanır ve `docs/free-tier-limits.md`'ye kaynak linkiyle yazılır. Ücretsiz yol çalışmazsa durulur ve alternatif sunulur.
- **K-0.3** Hesap açma, API anahtarı alma, OAuth uygulaması oluşturma Timurhan'ın işidir; Claude adım adım talimat yazar ve bekler.
- **K-0.4** Gizli bilgiler yalnızca Cloudflare secrets, GitHub Actions secrets, Supabase vault ve git'e girmeyen yerel `.env` içinde. `.env.example` güncel tutulur.
- **K-0.5** Arayüz metinleri ve Papi'nin tüm mesajları Türkçe; kod, değişken adları, commit mesajları İngilizce.
- **K-0.6** Küçük commit'ler. Testsiz modül tamamlanmış sayılmaz.
- **K-0.7** Varsayımlar bu dosyanın "Varsayımlar" bölümüne yazılır ve faz sonunda listelenir.
- **K-0.8** Kararlar sorgulanmadan uygulanır; teknik olarak uygulanamayan karar için durulur, neden + alternatifler sunulur, onay beklenir.

## Proje (Bölüm 1)

- **K-1.1** Ürün adı **Papi**; AJNA Digital'in yapay zeka destekli ajans işletim sistemi.
- **K-1.2** Tek kullanıcı: Timurhan. Sistem paylaşılmaz; dış erişim yok. İstisnalar: analiz aracı (Bölüm 12) ve kişiye özel demo sayfaları (Bölüm 13.8) — herkese açık ama dahili veri okumaz.
- **K-1.3** Altyapı baştan multi-tenant: her tabloda `tenant_id`, tüm erişim RLS ile kiracıya bağlı. Şu an tek kiracı: AJNA.
- **K-1.4** Kapsam sadece AJNA; başka marka/çalışma alanı yok.
- **K-1.5** Tüm modüller tek sürümde teslim edilir; iç kurulum sırası fazlara göredir (Bölüm 18).

## Temel ilkeler (Bölüm 2)

- **K-2.1** Son onay her zaman Timurhan'da. Dışarı giden her şey (mail, mesaj, post, teklif, ödeme linki) onay kuyruğundan geçer. Okuma, araştırma, analiz, taslak serbest.
- **K-2.2** Tek onay istisnası: analiz aracını kullanan kişiye giden analiz raporu onaysız gider. Sonraki her satış mesajı onaylıdır.
- **K-2.3** Sıfır maliyet / maksimum verim: önce kural sonra model; şablon + kişisel kısım (model yalnızca kişisel kısmı yazar); toplu işleme; her sonuç önbelleğe alınır; ağır işler gece vardiyası ve sakin saatlere yayılır.
- **K-2.4** Sağlayıcıdan bağımsız beyin; Claude'a geçiş tek ayar değişikliği olmalı.
- **K-2.5** Hiçbir kayıt sıradaki adımsız durmaz: ya playbook'ta, ya bekleme nedeni + tarihi var, ya kapalı.
- **K-2.6** Her eylem kayıt altında: ne, kim onayladı, hangi model, kaç token, ne kadar kota.
- **K-2.7** Reddedenler listesi kalıcı ve global; her mailde çıkış linki; KVKK'ya uygun saklama.

## Teknik altyapı (Bölüm 3)

- **K-3.1** Dil: TypeScript (her yerde).
- **K-3.2** Repo: pnpm workspaces monorepo.
- **K-3.3** API, Telegram webhook, zamanlayıcı: Cloudflare Workers (Hono) + Cron Triggers.
- **K-3.4** Web panel: Cloudflare Pages, React + Vite + Tailwind + shadcn/ui, mobil uyumlu.
- **K-3.5** Veritabanı, auth, dosya, vektör: Supabase ücretsiz katman (Postgres, Auth, Storage, pgvector).
- **K-3.6** Ağır işler (site tarama, toplu analiz, yedek): GitHub Actions (Node + Playwright).
- **K-3.7** Beyin: Gemini API (AI Studio ücretsiz) birincil; Groq ücretsiz yedek; Anthropic Claude adaptörü hazır ama kapalı.
- **K-3.8** Embedding: Gemini embedding modeli.
- **K-3.9** Ses→yazı: Groq Whisper. Yazı→ses: ücretsiz kotalı sağlayıcı (ElevenLabs ücretsiz kota veya Gemini TTS), adaptör arkasında.
- **K-3.10** Canlı sesli konuşma: Gemini Live API, panelde, tarayıcıdan, geçici (ephemeral) token ile.
- **K-3.11** Harita: Leaflet + OpenStreetMap.
- **K-3.12** Herkese açık formlarda bot koruması: Cloudflare Turnstile.
- **K-3.13** Hata takibi: Sentry ücretsiz katmanı (kart istemiyorsa) veya kendi hata tablosu.
  - Değişiklik (2026-10-13, Timurhan onayı, A-2): **kendi hata tablosu** (`error_events`); ciddi hatalar Telegram'a anında gider. Sentry kullanılmaz.
- **K-3.14** Monorepo yapısı: `apps/{api,web,jobs}`, `packages/{core,prompts,modules}`, `supabase/{migrations,seed,policies}`, `docs/`, `.github/workflows/`. İyileştirme yapılırsa Timurhan'a bildirilir.
- **K-3.15** Kuyruk: Supabase'de tablo tabanlı `jobs` (tür, payload, durum, `run_after`, deneme sayısı, kilit). Worker cron'u her dakika kısa işleri dağıtır; ağır işler GitHub Actions'a devredilir.
- **K-3.16** Workers ücretsiz CPU süresi sınırı dikkate alınır; ağır parse/tarama Actions'ta.
- **K-3.17** GitHub Actions dakika kotası hesaplanır, aşılmayacak zamanlama kurulur; gerekirse seçenek sunulur.

## Beyin katmanı (Bölüm 4)

- **K-4.1** Tek `LLMProvider` arayüzü: `generate`, `generateStructured` (JSON şema), `embed`, `transcribe`, `speak`.
- **K-4.2** Adaptörler: Gemini (aktif), Groq (yedek), Anthropic (kapalı, hazır).
- **K-4.3** Görev seviyesi yönlendirme: `light` (sınıflandırma, çıkarım, eleme), `medium` (mesaj, teklif, analiz yazımı), `heavy` (strateji, karmaşık planlama). Seviye → sağlayıcı/model eşlemesi ayarlardan.
- **K-4.4** Kota yönetimi: sağlayıcı başına dakika/gün sınırları ayarlardan. Sınıra yaklaşınca iş kuyrukta bekler veya yedeğe geçer. Günlük kota kullanımı panelde görünür.
- **K-4.5** Önbellek: girdi hash'i ile sonuç saklanır; aynı girdi tekrar modele gitmez.
- **K-4.6** Toplu işleme: analiz ve puanlama birden fazla firmayı tek istekte işler.
- **K-4.7** Gizlilik kuralı: kazanılmış/sözleşmeli müşterilerin hassas verileri ve kişisel veriler ücretsiz katman modellerine gönderilmez. Herkese açık işletme bilgileri, analizler, mesaj taslakları gönderilebilir. Kodda veri sınıflandırma kuralı olarak uygulanır.
- **K-4.8** Her çağrı `llm_calls` tablosuna: ajan, görev, sağlayıcı, model, token, süre, önbellekten mi.

## Ajanlar (Bölüm 5)

- **K-5.1** Ajanlar ayrı programlar değil; aynı tool-use döngüsünün farklı rol promptları ve araç izin listeleri. Promptlar `packages/prompts` altında versiyonlu.
- **K-5.2** Ajanlar: **Papi** (ana muhatap, dağıtıcı), **Kaşif** (aday bulma, sinyal, mükerrer engelleme), **Analist** (site/dijital iz analizi, puan, mini analiz), **Ulak** (mesaj yazımı, playbook yürütme, zamanlama, tek tık kuyruğu), **Satıcı** (cevap sınıflandırma, cevap taslağı, görüşme, teklif, demo, görüşme notu), **Operatör** (kurulum formu, teslim modülleri, Claude Code promptu, kontrol listesi, projeler, aylık rapor, ödeme/yenileme), **Kalem** (X, LinkedIn, Instagram içerikleri).
- **K-5.3** Papi'nin araçları en az: CRM okuma/yazma, aday ekleme (link, isim, CSV), analiz başlatma, playbook başlatma/durdurma, taslak oluşturma, onay kuyruğu, takvim, notlar, projeler, finans kayıtları, rutin oluşturma, bilgi bankası arama, ölçütleri okuma.

## Hafıza (Bölüm 6)

- **K-6.1** Üç katman, hepsi Supabase'de, arama pgvector ile: AJNA kimliği (bilgi bankası), firma hafızası, stil hafızası.
- **K-6.2** Bilgi bankası panelden düzenlenir; Timurhan sesli de anlatabilir, Papi düzenleyip kaydeder.
- **K-6.3** Marka seed: AJNA Digital; alt başlık "AI. SYSTEMS. GROWTH. CREATIVE."; kollar AJNA Systems / AJNA Growth / AJNA Creative; konumlandırma premium, minimal, global; spiritüel konumlandırma yok; slogan "Personel değil, refleks kuruyoruz."; Instagram @ajnadigitalagency; alan adı ajnadigitalagency.com.
- **K-6.4** Ton profili uygulama içinden ayarlanır; varsayılan **boş** profil oluşturulur. Kullanılmayacak ifadeler listesi ayarlarda.
- **K-6.5** İdeal müşteri: müşteri başı değeri yüksek işletmeler (emlak, klinik, oto galeri/bayi, inşaat/tadilat, özel eğitim, otel, OSB üreticileri gibi). Tek sektöre kilitlenme yok.
- **K-6.6** İtirazlar/cevaplar, vaka çalışmaları, hazır modül kataloğu başlangıçta boş şablonlar.
- **K-6.7** Firma hafızası: analiz, puan geçmişi, temaslar, cevaplar, görüşme notları, teklifler.
- **K-6.8** Stil hafızası: onaylanan/düzeltilen/reddedilen her taslak düzeltme farkıyla saklanır; Ulak ve Satıcı benzer düzeltmeleri bağlam olarak kullanır; tekrar eden düzeltmeler "öğrenilen kural" önerisi olur, onaylanırsa kalıcı kural.

## Paketler ve fiyatlar (Bölüm 7)

- **K-7.1** Tüm fiyatlar ayarlardan düzenlenebilir.
- **K-7.2** KDV dahil/hariç alanı ayarlarda; başlangıçta "belirtilmedi"; teklif üretirken Timurhan'a sorulur.
- **K-7.3** Seed paketler:
  - **Refleks** — 17.500 TL/ay (kurulumsuz): WhatsApp/Instagram/site mesajlarına anında cevap asistanı; ilgilenen kişinin kaydı + sahibine bildirim; cevapsız adaylara otomatik takip; aylık performans raporu.
  - **Sistem** — 25.500 TL/ay: Refleks + teklif/satış takibi, randevu ve ödeme hatırlatmaları, Google yorum toplama/cevaplama, işletmenin bir programıyla bağlantı, iki haftada bir iyileştirme.
  - **Operasyon** — 40.000 TL'den başlar: Sistem + işletmeye özel iç süreç otomasyonları, ayda belirli saat yeni otomasyon geliştirme (saat sınırı ayarlardan, başlangıçta boş, teklifte zorunlu alan), aylık strateji görüşmesi, öncelikli destek.
  - **Özel** — 50.000 TL'den başlayan proje + isteğe bağlı aylık bakım (proje bedelinin %8–10'u). Formül: Operatör işi parçalara böler, gün tahmini × günlük ücret (ayarlardan) + belirsizlik payı. Kapsam dışı her talep ayrı fiyatlanır.
- **K-7.4** Refleks/Sistem/Operasyon için iki ödeme yolu:
  - Kurulumsuz: aylık ücret, 12 ay taahhüt, ilk ay peşin; erken çıkışta kurulum bedelinin kalan kısmı ödenir.
  - Kurulumlu: bir aylık ücret kadar kurulum bedeli, aylık ücret %15 düşük, 3 ay taahhüt.
- **K-7.5** Kurucu müşteri indirimi: ilk 3 müşteriye kurulumda %40'a kadar, aylıkta ilk 3 ay %20. Kontenjan sayacı sistemde; teklif mesajlarında yalnızca gerçekten doluysa (gerçek durum doğruysa) kullanılır.
- **K-7.6** Teslim ilkesi: müşteri sistemleri müşterinin kendi hesaplarında, kendi API anahtarlarıyla çalışır.

## Aday kaynakları (Bölüm 8)

- **K-8.1** Gemini grounding araması; sonuçlar sitelerden doğrulanmadan CRM'e girmez. Grounding ücretsiz limitleri doğrulanır.
- **K-8.2** OpenStreetMap Overpass API (ek kaynak).
- **K-8.3** Ticaret odası/sektör derneği rehberleri (kullanım şartlarına uygun herkese açık listeler).
- **K-8.4** Instagram Graph API business discovery — Timurhan'ın kendi Meta uygulaması ve işletme hesabıyla. Başkasının hesabını kazımak yok.
- **K-8.5** CSV içe aktarma (panel).
- **K-8.6** Telegram'dan link → Kaşif firmayı oluşturur, Analist analiz eder, puan ve playbook atanır.
- **K-8.7** Analiz aracı → gelen aday.
- **K-8.8** Google Places adaptörü yazılır ama kapalı (kart gerektiriyor).
- **K-8.9** Google Maps kazıma yapılmaz.
- **K-8.10** Mükerrer kontrolü: alan adı, telefon, normalize isim + adres.

## Analiz ve puanlama (Bölüm 9)

- **K-9.1** Analist önce kodla, sonra modelle kontrol eder: site varlığı, PageSpeed Insights (hız + mobil), SSL, iletişim formu, WhatsApp butonu/linki, online randevu/sipariş, sosyal hesaplar, son paylaşım tarihi (erişilebilirse), Google yorumlarına cevap (erişilebilir kaynaktan), iletişim bilgisi ve karar verici adı.
- **K-9.2** Model çıktısı: 3 maddelik "muhtemel elle yapılan işler / kaçan fırsatlar" + tek cümlelik en güçlü bulgu.
- **K-9.3** Puan 100: Uygunluk 40 (sektör değeri, büyüklük sinyalleri, bölge önceliği: Balıkesir → Marmara → Türkiye, ayarlardan), Dert 40 (yavaş/eksik cevap kanalları, cevapsız yorumlar, eksik/yavaş site, WhatsApp/randevu yok, aktif sinyal), Ulaşılabilirlik 20 (doğrulanmış iletişim, karar verici, birden fazla kanal).
- **K-9.4** Eşikler: 70+ Soğuk Ana; 50–69 Hafif Soğuk; <50 bekleme listesi (yeni sinyalde yeniden puanlanır). Ağırlık ve eşikler ayarlardan. Her puanın gerekçesi kartta görünür.

## Kanallar ve gönderim (Bölüm 10)

- **K-10.1** Mail: Papi gönderir, onaydan sonra, iş saatinde.
- **K-10.2** WhatsApp: tek tık (`wa.me/{telefon}?text={mesaj}`), Timurhan gönderir. WhatsApp Business Cloud API kapalı adaptör (ücretli mesaj).
- **K-10.3** Instagram DM: tek tık (profil açılır, mesaj panoya). Kendi işletme hesabına gelen DM'ler Graph API ile gelen kutusuna (mümkünse).
- **K-10.4** LinkedIn: tek tık (profil + kopya).
- **K-10.5** X: tek tık intent linki; API kullanılmaz.
- **K-10.6** Telefon: Papi arama listesi + konuşma notu hazırlar, Timurhan arar, sesli not atar. **Yapay zeka ile arama yok.**
- **K-10.7** Yüz yüze: günlük ziyaret rotası + firma başına yazdırılabilir tek sayfalık analiz.
- **K-10.8** Mail altyapısı (Natro SMTP/IMAP vs Gmail API) **açık karar**: seçenekler artı/eksi ile sunulacak, onay beklenecek (Faz 3 öncesi).
- **K-10.9** Ana alan adını koruma: günlük düşük limit (varsayılan 20, ayarlardan), kademeli ısınma, rastgele aralıklı gönderim.
- **K-10.10** Mail ve tek tık hatırlatmaları yalnızca iş saatinde (varsayılan hafta içi 09:30–18:00 TR, ayarlardan). Gece onaylanan iş, iş saatinde gider.
- **K-10.11** Aynı kişiye haftada en fazla 2 temas.
- **K-10.12** Cevap gelen her dizi anında durur.
- **K-10.13** Her mailde çıkış linki. "Yazmayın" diyen veya çıkış linkine basan kişi/firma global reddedenler listesine girer; hiçbir playbook, kanal, manuel işlem mesaj oluşturamaz (kodda zorunlu kontrol + test).
- **K-10.14** Firma başına en fazla 1–2 kişiye ulaşılır.
- **K-10.15** Soğuk mail ≤ 80 kelime (doğrulama kuralı).
- **K-10.16** Tek tık kuyruğunda her öğede "gönderdim" butonu → temas kaydı + dizi ilerler.

## Playbook motoru (Bölüm 11)

- **K-11.1** Playbook'lar veritabanında; panelden ve Telegram'dan doğal dille eklenip düzenlenir. Adım: gün ofseti, kanal, mesaj türü/açı, koşullar.
- **K-11.2** Adım bazında performans: gönderim, cevap, olumlu cevap, görüşme, kazanım.
- **K-11.3** Seed set: Soğuk Ana (21 gün, 8 temas), Hafif Soğuk (14 gün, 4 temas), Sinyal (10 gün, 4–5 temas), Sıcak Gelen, Ziyaret Sonrası, Teklif Takibi, Uyandırma, Şimdi Değil, Referans (+ ortaklar dizisi), Müşteri Yaşamı — adımlar talimat Bölüm 11'deki gibi.
- **K-11.4** Sıcak Gelen: analiz raporu anında ve onaysız; aynı gün arama görevi; G2 görüşme teklifi (onaylı); G5 takip; "ilk cevap süresi" ölçülür.
- **K-11.5** Teklif Takibi'nde kurucu indirimi kontenjanı açısı yalnızca gerçek durum doğruysa.
- **K-11.7** (2026-10-13, Timurhan onayı) Soğuk Ana'nın 8. teması: G17 kısa LinkedIn mesajı. Sıra: G1 mail, G3 WhatsApp, G5 Instagram DM, G7 demo, G10 telefon, G14 fikir maili, G17 LinkedIn, G21 kapanış maili.
- **K-11.6** Papi öğrenimlerden playbook değişikliği **önerir**; uygulama Timurhan'ın onayıyla.

## Analiz aracı (Bölüm 12)

- **K-12.1** AJNA sitesine (şu an Netlify) gömülecek sayfa/bileşen; gömme kodu veya ayrı sayfa + ekleme dokümanı.
- **K-12.2** Girdi: işletme adı veya sitesi + mail. KVKK aydınlatma linki ve açık onay kutusu zorunlu. Turnstile + IP bazlı hız sınırı.
- **K-12.3** Rapor birkaç dakika içinde, onaysız mail ile: hız ve mobil, iletişim kanalları, yorum yönetimi, 3 somut öneri, AJNA'ya yumuşak yönlendirme.
- **K-12.4** Kişi + firma CRM'e "Sıcak Gelen" olarak düşer; Timurhan'a anında Telegram bildirimi.
- **K-12.5** Günlük toplam analiz limiti (ayarlardan).

## Panel (Bölüm 13)

- **K-13.1** Tasarım: AJNA logosuna uyumlu; siyah zemin, mor-mavi parıltı vurguları, premium, minimal. Logo yer tutucu (Timurhan verecek). Mobilde tam kullanılabilir. Tüm metinler Türkçe.
- **K-13.2** Modüller: Bugün, CRM, Gelen kutusu, Playbook'lar, Harita, Rutinler, Teklif stüdyosu, Kişiye özel demo, Projeler, Teslim modülleri, Finans, Notlar, İçerik (Kalem), Ölçütler, Bağlantılar, Ayarlar, Yapılanlar, Müşteri portalı.
- **K-13.3** CRM firma kartında sıradaki adım **zorunlu**; puan + gerekçe, analiz, zaman çizelgesi, aktif playbook.
- **K-13.4** Gelen kutusu sınıfları: ilgileniyor, soru, sonra, hayır, yazmayın, otomatik yanıt.
- **K-13.5** Hazır rutinler: sabah brifingi, bugün kimi aramalıyım, sinyal taraması, haftalık rakip taraması, sektör haberlerinden fırsat, ödeme gecikme kontrolü, aylık müşteri raporları, haftalık patron özeti. Doğal dille yeni rutin.
- **K-13.6** Teklif stüdyosu: iki ödeme yolu yan yana, kurucu indirimi, PDF, onaylı gönderim.
- **K-13.7** Demo: Worker'da `/demo/{tahmin edilemez token}`; 14 gün sonra otomatik kapanır; ziyaret/kullanım sayısı firma kartına işlenir; demo sistemdeki başka hiçbir veriyi okuyamaz.
- **K-13.8** Finans: gelir-gider, abonelik, tahsilat, MRR. iyzico/PayTR adaptörü hazır ama kapalı; ödeme linki manuel. Fatura kesimi manuel.
- **K-13.9** İçerik (Kalem): tanıtım içeriklerinde şehir adı geçmez; mesaj "her işletme ve KOBİ'ye özgün çözümler". Onaylananlar tek tık kuyruğuna.
- **K-13.10** Bağlantılar: yalnızca kullanılanlar (mail, Google Takvim, Instagram/Meta, Telegram); kapalı adaptörler "kapalı" listelenir. Entegrasyon katmanı kolay genişleyebilir (MCP uyumlu araç arayüzü tercih).
- **K-13.11** Müşteri portalı: altyapı kurulur, **kapalı özellik bayrağı** arkasında; Timurhan açmadıkça dış kullanıcı giriş yapamaz.

## Teslim modülleri (Bölüm 14)

- **K-14.1** `packages/modules`: cevap asistanı, takip dizisi, randevu/ödeme hatırlatma, Google yorum toplama/cevaplama, aylık performans raporu. Her biri: README, JSON Schema yapılandırma, müşteri hesaplarında kurulum rehberi, test listesi.
- **K-14.2** Kurulum formu → Operatör üretir: müşteriye özel yapılandırma dosyası, Claude Code kurulum promptu, kontrol listesi; projeye bağlar.
- **K-14.3** Modüller şablon + doküman; en az **cevap asistanı** için çalışan referans implementasyon.

## Telegram ve gece vardiyası (Bölüm 15)

- **K-15.1** Bot yalnızca Timurhan'ın Telegram kullanıcı kimliğine cevap verir; diğerleri sessizce yok sayılır ve kayda geçer.
- **K-15.2** Yazı + sesli not (Groq Whisper); isteğe bağlı sesli cevap. Komutlar: `/bugun`, `/onaylar`, `/ekle {link}`, `/ara`, `/rapor`, `/uyuyorum`, `/uyandim`, `/kota`.
- **K-15.3** Onaylar inline butonla: Onayla, Düzelt (metin veya sesli not), Reddet. Toplu taslaklar tek mesajda gruplanır; tek tek veya toplu onay.
- **K-15.4** Anlık bildirimler (hepsi): sıcak cevap, ödeme geldi/gecikti, sistem hatası, onay bekleyen iş (gruplu), günlük raporlar, iş haberleri/fırsatlar.
- **K-15.5** `/uyuyorum`: sessiz mod + gece vardiyası (aday bulma, tarama, analiz, puanlama, taslak, kuyruk doldurma). Sessizde yalnızca sistem hatası ve sıcak cevap sesli gelir (sessiz bildirim seçeneği ayarlardan). `/uyandim`: sessiz mod kapanır + özet. Otomatik zaman penceresi ayarlardan. Mail gönderimi her durumda iş saatine bağlı.
- **K-15.6** Panelde "Papi ile konuş" (Gemini Live, araç erişimli); limitler doğrulanır, kullanım süresi gösterilir.

## Ölçütler (Bölüm 16)

- **K-16.1** Tepe: MRR ve hedefe kalan (hedef ayarlardan), hattaki tekliflerin toplam değeri, gelen adaya ilk cevap süresi.
- **K-16.2** Huni (playbook/kanal filtreli): temas → cevap → olumlu cevap → görüşme → teklif → kazanım; oranlar, ortalama satış süresi.
- **K-16.3** Müşteri: aktif sayı, müşteri başı gelir, iptal oranı, yaklaşan yenilemeler.
- **K-16.4** Sistem sağlığı: sağlayıcı bazında kota doluluğu, kuyruk, en uzun bekleyen onay, hata sayısı, Actions dakika kullanımı.
- **K-16.5** Haftalık patron özeti rutini.

## Güvenlik ve yasal (Bölüm 17)

- **K-17.8** (2026-10-13, Timurhan onayı, A-4) GitHub reposu **özel** kalır; Actions dakika bütçesi 2.000 dk/ay'a göre planlanır.
- **K-17.1** Panel girişi: Supabase Auth, mail + şifre + **zorunlu TOTP**. Kayıt kapalı; yalnızca tanımlı tek mail giriş yapabilir.
- **K-17.2** RLS tüm tablolarda, `tenant_id` bazlı. Servis anahtarı yalnızca sunucu tarafında.
- **K-17.3** Gizli bilgi repoya girerse commit engellenir (gitleaks veya pre-commit kontrolü).
- **K-17.4** Herkese açık uçlar (analiz aracı, demo, çıkış linki, Telegram webhook): Turnstile, hız sınırı, imzalı/tahmin edilemez token, webhook gizli token doğrulaması; dahili veriye erişemez.
- **K-17.5** Yedek: her gece GitHub Actions ile `pg_dump`, şifreli (age veya gpg), özel depo veya Actions artifact; saklama süresi + geri yükleme dokümante edilir ve bir kez test edilir.
- **K-17.6** Audit log değiştirilemez.
- **K-17.7** KVKK: çıkış linki, global reddedenler, analiz aracında aydınlatma + açık onay, kazanılmayan adayların kişisel verilerinin ayarlanabilir süre sonra (varsayılan 12 ay) otomatik silinmesi/anonimleştirilmesi, tek tık veri silme. Aydınlatma metni şablonu yazılır; avukat/mali müşavir kontrolü gerektiği belirtilir. İYS uyumu için uzmana danışılması notu bırakılır.

## Fazlar (Bölüm 18)

- **K-18.1** Faz 0 Temel → Faz 1 Beyin ve Telegram → Faz 2 Aday ve analiz → Faz 3 Ulaşma → Faz 4 Satış → Faz 5 Operasyon → Faz 6 Zeka ve otomasyon → Faz 7 Dış yüz ve sertleştirme. İçerik ve kabul kriterleri `docs/roadmap.md`'de.

## Teslim (Bölüm 19)

- **K-19.1** Teslimde: çalışan sistem + canlı adresler; `docs/` altında kararlar, mimari, ücretsiz limitler, kurulum/yeniden kurulum, yedekten geri yükleme, yeni entegrasyon, yeni playbook, Claude'a geçiş, Places ve WhatsApp Business'ı açma rehberleri; varsayımlar ve açık noktalar listesi.

---

## Faz 4 kararları (2026-10-13, Timurhan onayı)

- **K-4.9** (A-7) Gelen cevaplar ve görüşme notları modele gitmeden önce kodla ayıklanır: e-posta, telefon, CRM'deki
  kişi adları, unvanlı adlar ("Ahmet Bey", "Dr. ..."), imza bloğu, TC kimlik ve IBAN yer tutucuyla değiştirilir.
  Geriye kalan işletme ihtiyacı "dahili" sınıftadır ve ücretsiz modele gidebilir. Kazanılmış müşteri verisi hiçbir
  durumda gitmez (K-4.7 aynen geçerli).
- **K-13.12** (B-1) Teklif PDF'i panelde, tarayıcıda üretilir (pdf-lib + Türkçe destekli gömülü yazı tipi); dosya
  Supabase Storage'a özel olarak yüklenir.

## Faz 5 kararları (2026-10-13, Timurhan "devam" ile önerileri onayladı)

- **K-14.4** (C-1) Kurulum formunu müşteri doldurur: tahmin edilemez anahtarlı link, Turnstile, 30 gün geçerli.
  Timurhan panelden düzeltebilir. Form cevapları müşteri verisidir (`client_sensitive`); hiçbir modele gitmez,
  Operatör çıktıları şablonla üretilir.
- **K-14.5** (C-2) Cevap asistanı referans implementasyonu müşterinin kendi Cloudflare hesabında çalışan bir Worker'dır:
  site sohbet kutusu ve Instagram DM hazır; WhatsApp Business Cloud API adaptörü yazılı ama kapalı (ücret müşterinin).
  Yapay zeka müşterinin kendi anahtarıyla; müşterinin müşterilerinin mesajları kişisel veri olduğundan ücretli
  (eğitimde kullanılmayan) katman önerilir ve README/teklifte yazılır.

## Faz 6 kararları (2026-10-13, Timurhan onayı)

- **K-8.11** (D-1) Sinyal kaynakları: (a) yüksek puanlı firmaların sitesi haftada bir yeniden taranır, değişiklik
  (randevu/WhatsApp/sohbet eklenmesi-kaldırılması, yeni şube, kampanya ya da iş ilanı sayfası) sinyal olur;
  (b) haftada en fazla 20 firma için Gemini aramasıyla haber taraması; (c) OSM'de ilgili sektörlerde yeni açılan
  işletmeler haftalık. Instagram bağlanırsa paylaşım sıklığı eklenir.
- **K-3.18** (D-2) Harita konumu: adresi olan firmalar OpenStreetMap Nominatim ile (sonuç saklanır, atıf gösterilir)
  GitHub Actions'ta toplu konumlandırılır. _Uygulama notu:_ resmi politika düzenli çalışan betikleri dakikada 4
  istekle sınırlıyor; bu yüzden "saniyede 1" yerine 15 saniyede 1 istek kullanılıyor (karar özü aynı, daha sıkı uyum).

## Faz 7 kararları (2026-10-13, Timurhan "önerilerini yap" ile onayladı)

- **K-17.9** (E-1, A-5) Yedek hedefi: GitHub Actions artifact; günlük yedek 30 gün, ayın ilk yedeği 90 gün saklanır.
  Yedek `age` ile şifrelidir (açık anahtar repoda, gizli anahtar yalnızca Timurhan'da). GitHub Free'de artifact +
  Packages için hesap başına 500 MB (doğrulandı, bkz. free-tier-limits.md).
- **K-12.6** (E-2) Analiz aracı Worker'da `/analiz`; AJNA sitesine iframe ile gömülür. Rapor ekranda tahmin edilemez
  linkle 30 gün gösterilir; mail bağlandığında (A-1) ayrıca e-postayla gider.
- **K-15.7** (E-3) Canlı sesli konuşmada Papi yalnızca okuma araçlarını (bilgi bankası, notlar, firma arama, günün
  özeti, kota) ve not alma / sessiz modu kullanır; dışarı giden her şey onay kuyruğuna taslak düşer, sesle onay
  verilmez. Günlük varsayılan 20 dakika.

## Açık kararlar (Timurhan onayı bekliyor)

| #   | Konu                                                     | Ne zaman gerekli                              |
| --- | -------------------------------------------------------- | --------------------------------------------- |
| A-1 | Mail altyapısı: Natro SMTP/IMAP vs Gmail API (K-10.8)    | Masaüstü kurulum oturumu (Faz 3 canlı kabulü) |
| A-3 | TTS sağlayıcı: ElevenLabs ücretsiz vs Gemini TTS (K-3.9) | Faz 1                                         |
| A-6 | KDV dahil/hariç (K-7.2)                                  | İlk teklifte                                  |

## Varsayımlar

> Her faz sonunda Timurhan'a listelenir. Onaylanan varsayım karar maddesine dönüşür.

- **V-1** Talimat metninde fazlar için "Bölüm 17" denmiş, ancak fazlar Bölüm 18'de; güvenlik/yasal Bölüm 17'de. Roadmap Bölüm 18'i esas alır.
- **V-2** Talimattaki `papi/` kök klasörü bu repo (`papios`) kökü olarak uygulanır; ayrıca iç içe `papi/` klasörü açılmaz.
- **V-3** Talimatta "Kişiye özel demo" panelde modül 8 olarak geçer; K-13.7 buna göre numaralandı.
- **V-4** `docs/` belgeleri Türkçe yazılır (kural K-0.5 yalnızca arayüz/kod/commit dilini belirliyor).
- **V-5** Para tutarları veritabanında TL kuruş cinsinden tam sayı (`bigint`) saklanır.
- **V-6** Paket ve fiyat seed'leri talimattaki değerlerle; Operasyon saat sınırı ve Özel paket günlük ücret alanları boş (NULL) bırakılır.
- **V-7** Supabase ücretsiz projeler belli süre hareketsizlikte duraklatılabildiği için (doğrulandı: 1 hafta, bkz. free-tier-limits.md) Worker cron'unun düzenli DB erişimi projeyi aktif tutar; ayrıca gerekirse Actions'ta hafif bir "keep-alive" işi eklenir.
- **V-8** Gömme vektörleri 768 boyutlu saklanır (Gemini embedding çıktı boyutu ayarlanabilir; pgvector HNSW indeksi 2.000 boyuta kadar destekler). Faz 1'de modelle doğrulanacak.
- **V-9** `audit_log` kişisel veri taşımaz, yalnızca kimlik (id) taşır; böylece KVKK silmesi değiştirilemez kaydı bozmaz.
- **V-10** Reddedenler listesi ham değeri değil, normalize edilmiş değerin SHA-256 özetini saklar; kişi KVKK kapsamında silinse bile engel sürer.
- **V-11** Mail ısınma eğrisi: günde 20 ile başla, her 7 günde +5, en çok 50; gönderimler arası rastgele 4–15 dk. Ayarlardan değişir.
- **V-12** Analiz aracı günlük toplam limit varsayılanı 20.
- **V-13** ~~Soğuk Ana 8. temas~~ → K-11.7 ile karara bağlandı.
- **V-14** Hafif Soğuk adımları: G1 mail, G4 WhatsApp, G8 Instagram DM, G14 kapanış maili.
- **V-15** Sinyal adımları: G1 mail, G3 WhatsApp, G5 Instagram DM, G7 telefon, G10 kapanış maili.
- **V-16** Teklif Takibi kanalları: G2 mail (soru), G5 WhatsApp (örnek), G10 mail (kurucu kontenjanı, yalnızca gerçekse), G20 mail (son takip).
- **V-17** Uyandırma: G0 mail, G4 WhatsApp, G10 mail. Ortaklar referans dizisi (`referans_ortak`): G1 mail, G5 WhatsApp, G14 mail. Ziyaret Sonrası G5 takibi mail.
- **V-18** Telefon ve ziyaret adımları Timurhan'ın kendi görevleri olduğu için onay kuyruğuna girmez (Papi bir şey göndermiyor). Veritabanı kısıtı: onaysız adım yalnızca telefon/ziyaret veya analiz raporu olabilir.
- **V-19** Bilgi bankası panelde ayrı menü değil, Ayarlar altında (K-13.2 listesine sadık kalındı). Müşteri portalı menüde yok (kapalı bayrak).
- **V-20** RLS politikaları ayrı `supabase/policies/` klasörü yerine tabloyla aynı migration dosyasında durur (Supabase CLI yalnızca `migrations/` uygular; tablo ve politikası birlikte okunur). Yapı değişikliği K-3.14 gereği bildirilir.
- **V-21** Panel, Cloudflare Pages'in Git entegrasyonuyla yayınlanır (build Cloudflare'de olur, GitHub Actions dakikası harcamaz).
- **V-22** Canlı veritabanına migration, yalnızca elle tetiklenen `DB deploy` iş akışıyla uygulanır.
- **V-23** `SUPABASE_ACCESS_TOKEN` mobil kurulum kolaylığı için "Full access" kapsamıyla, 90 günlük oluşturuldu. Faz 7 güvenlik gözden geçirmesinde yalnızca gereken izinlerle (proje okuma, veritabanı ve auth yapılandırması yazma) yeniden oluşturulacak.
- **V-24** Canlı kurulum (GitHub secrets, DB deploy, Pages, Faz 1 anahtarları) bilgisayar başında tek oturuma ertelendi. Oluşturulan ilk Supabase token'ı kullanılmadan iptal edilecek.
- **V-25** Model adları sabit sürüm yerine sağlayıcının takma adlarıyla (`gemini-flash-latest`, `gemini-flash-lite-latest`) ayarlandı; Groq yedekleri `openai/gpt-oss-20b` / `openai/gpt-oss-120b`, Whisper `whisper-large-v3-turbo`, gömme `gemini-embedding-001` (768 boyut). Kota değerleri gerçek limitler doğrulanana kadar düşük tutuldu (Gemini 10 dk / 250 gün). Günlük `llm.verify_models` işi ayardaki modeller sağlayıcıda yoksa Telegram'a uyarır. Kota sayfaları canlı kurulumda teyit edilecek.
- **V-26** (A-3) Yazı → ses için Gemini TTS seçildi (ek hesap gerektirmez). Model adı ayarda boş olduğu için sesli cevap şimdilik kapalı; Telegram'a WAV dosyası olarak gider (OGG/Opus dönüşümü Workers'ta ağır).
- **V-27** Ajan döngüsü sağlayıcıya özel "function calling" yerine tek bir JSON protokolü kullanır (her modelde aynı çalışır, test edilebilir). Bir Telegram turu en fazla 4 adım (Workers alt istek bütçesi).
- **V-28** Firma hafızasında yalnızca herkese açık analizler (kind = analysis) vektörleştirilir; temas/cevap/görüşme notları kişisel veri içerebileceği için ücretsiz modele gönderilmez, anahtar kelimeyle aranır (K-4.7).
- **V-29** Sesli notların yazıya çevrilmesi (Groq Whisper) K-3.9 gereği yapılır; Timurhan'ın kendi komutları `internal` sınıfındadır. Faz 4'teki görüşme notları kişisel veri içereceği için o fazda ayrıca ele alınacak.
- **V-30** ~~`/ekle` linkleri ağır iş~~ → V-33 ile değişti: linkler hafif iş olarak Worker'da işlenir.
- **V-31** CI her push'ta bir kez çalışır (ayrı pull_request tetikleyicisi yok); PR'lar sonucu commit durumu üzerinden görür.
- **V-32** `app` şeması Supabase Data API'sine açıldı (RPC çağrıları için). Bu şemadaki her fonksiyonun yetkisi tek tek verilir; servis rolüne özel olanlar (`claim_jobs`, `consume_quota`, `attach_owner`) kullanıcılara kapalıdır.
- **V-33** Kabul kriterindeki 5 dakika için tek link analizi Worker'da yapılır: ana sayfa + iletişim sayfası düz HTTP ile çekilir (en fazla 200 KB), PageSpeed yalnızca gereken alanlarla sorgulanır, tek model çağrısı yapılır. Playwright derin taraması, toplu analiz, CSV/OSM/web araması içe aktarmaları GitHub Actions'ta (K-3.6). Telegram webhook'unun arka plan süresi (~30 sn) PageSpeed için yetmediği için link önce kuyruğa girer; her dakika çalışan cron (15 dk'ya kadar çalışabilir) işler. Cron turu başına 1 iş (Workers 50 alt istek sınırı).
- **V-34** Düz HTTP ile okunamayan site önce Playwright ile denenir; tarayıcı da açamazsa firma "çalışan web sitesi yok" olarak puanlanır. Böylece hiçbir kayıt sıradaki adımsız kalmaz (K-2.5).
- **V-35** Bekleme listesine düşen firmanın yeniden değerlendirme tarihi 90 gün sonrası (yeni sinyal gelirse daha erken yeniden puanlanır, Faz 6).
- **V-36** Puanlama ayrıntısı (sektör değeri 22/12/5, şube +6, bölge 10→3, mobil hız <50 → +8, WhatsApp yok +6, online randevu/sipariş yok +6, telefon/e-posta/karar verici +6/+5/+5 vb.) kodda tanımlıdır; ağırlıklar ve eşikler ayarlardan değişir. Ham puanlar ilgili bloğun ağırlığına ölçeklenir.
- **V-37** Kısa Google Haritalar linkleri (maps.app.goo.gl) işletme adı içermediği için açılmaz (harita kazıması yok, K-8.9); uzun linklerde ad URL'den okunur ve resmi site Google araması destekli sorguyla bulunup site açılarak doğrulanır.
- **V-38** Web sitesinden bulunan karar verici adları (ör. "Uzm. Dr. ...") kişiler tablosuna kaydedilir. Sitenin metin özeti herkese açık işletme bilgisi sayılır ve modele gidebilir; kişiler tablosundaki veriler modele gönderilmez.
- **V-39** CSV içe aktarma panelde ayrıştırılır, `app.enqueue_csv_import` ile (RLS kontrollü) ağır iş olarak kuyruğa girer, en fazla 2.000 satır.
- **V-40** Ağır işler 6 saatte bir (dakika bütçesi) ve isteğe bağlı olarak Worker'ın anında tetiklemesiyle çalışır; bunun için GitHub'da yalnızca bu repoya "Actions: write" yetkili ince ayarlı bir token gerekir (isteğe bağlı).
- **V-41** Gönderen adı "Timurhan | AJNA Digital", imza "Timurhan / AJNA Digital · ajnadigitalagency.com" varsayılandır; ayarlardan (`outreach`) değişir. Soğuk sayılan playbook'lar: Soğuk Ana, Hafif Soğuk, Sinyal, Uyandırma (80 kelime kuralı yalnızca bunların ilk mailinde).
- **V-42** Cevap sınıflandırma (ilgileniyor / soru / sonra / hayır / yazmayın / otomatik yanıt) kural tabanlıdır: cevap metni kişisel veri olduğundan ücretsiz modele gitmez (K-2.5). Belirsiz cevap "Cevap" olarak sıcak bildirime düşer.
- **V-43** "Yazmayın" diyen ya da çıkış linkine basan kişinin adresi **ve firması** reddedenler listesine girer (firmadaki başka kişilere de yazılmaz). "Hayır" → kaybedildi, "sonra" → Şimdi Değil playbook'u.
- **V-44** Demo linki ve analiz raporu adımları Faz 4/7 gelene kadar atlanır (sebep kaydıyla); dizi bir sonraki adıma geçer.
- **V-45** Worker'da dakika başına tek ulaşma adımı çalışır (taslak / gönderim / gelen kutusu / tek tık sırayla), ücretsiz plandaki istek ve CPU sınırları için. Saatte en fazla 15 mail gönderim denemesi olur; ısınma limitleri bunun çok altındadır.
- **V-46** Panelden onay yalnızca onay satırını değiştirir (`app.panel_decide_approval`); zamanlama ve stil hafızası Worker'da yapılır (en geç 4 dakika gecikme). Elle düzenlenen metin kişi adını içerdiği için stil hafızasına metin olarak değil "elle düzenlendi" notu olarak yazılır.
- **V-47** Panelde "yeniden yaz" (talimatla düzeltme) şimdilik yalnızca Telegram'da; panelde düzenle / onayla / reddet var.
- **V-48** Satış varsayılanları (ayarlardan değişir): görüşme 30 dk; 3 öneri, en erken 4 saat sonra, 10 gün içinde, günde en çok bir öneri, tercih saatleri 10:00 / 14:00 / 11:30 / 16:00; teklif geçerliliği 14 gün; demo için demo başına günde 30, toplamda günde 200 ziyaretçi mesajı.
- **V-49** Panelin sunucu gerektiren işlemleri (taslak teklif, görüşme saati, görüşme notu, hazırlık notu, demo, teklif gönderildi/kabul/ret) Worker'daki `/panel/:işlem` ucundan yapılır. Kullanıcının kendi Supabase oturumu Supabase Auth ile doğrulanır; TOTP (aal2) ve kiracı üyeliği zorunludur. Yalnızca panel adresinden (CORS) çağrılabilir, her işlem audit'e yazılır.
- **V-50** Demo linki tahmin edilemez 32 baytlık bir anahtardır. Anahtar veritabanında RLS arkasında tutulur ki panelden yeniden paylaşılabilsin. Ziyaretler sayfa açılışında sayılır; WhatsApp'ın link önizlemesi de bir ziyaret sayılabilir. Ziyaretçinin yazdıkları ayıklanarak modele gider ve saklanmaz, yalnızca sayılır. Canlıda Turnstile zorunludur; IP başına 10 dakikada 20 mesaj sınırı vardır (IP özetlenir, ham hâli saklanmaz).
- **V-51** Kurucu müşteri indirimi, kontenjan gerçekten açıkken yeni tekliflere varsayılan olarak konur; Timurhan taslakta kaldırabilir. Kontenjan teklif **kabul edildiğinde** düşer ve sayaç veritabanında aşılamaz.
- **V-52** Takvim etkinlikleri yalnızca Timurhan'ın takvimine katılımcısız eklenir, dışarıya davet gitmez; bu yüzden onay kuyruğuna girmez. Saatleri firmaya iletmek, onaylı bir mesajla olur.
- **V-53** ⚠️ Sesli görüşme notu yazıya çevrilirken (Groq Whisper, ücretsiz katman) ayıklanamaz. Bu yüzden Papi, sesli notta kişi adı ve telefon söylenmemesini hatırlatır. Yazılı notlar ve sesli notun yazıya çevrilmiş hâli, modele gitmeden ayıklanır (K-4.9).
- **V-54** Mail bağlanana kadar (A-1) teklif şöyle gönderilir: PDF panelde oluşur, WhatsApp tek tıkla ya da elle gönderilir, ardından "Gönderildi" işaretlenir. Teklif Takibi dizisi "gönderildi" anında başlar.
- **V-55** Kabul edilen teklifin firması "Kazanıldı" olur ve sıradaki adımı "kurulum formu ve proje" (Faz 5) olarak 1 gün sonraya bekler. Reddedilen teklifin firması "Kaybedildi" olur ve 90 gün sonra yeniden değerlendirilir.
- **V-56** Görüşme notu, firmanın önerilmiş ya da planlanmış görüşmesi varsa ona yazılır; yoksa yeni bir "yapıldı" görüşmesi açılır. Model bir paket önerirse teklif taslağı kendiliğinden çıkar, KDV sorusu sorulur, ardından onaya gider.
- **V-57** Soğuk Ana'nın demo adımı (G7) artık gerçek bir 14 günlük demo oluşturur. Link e-postayla gider, e-posta yoksa WhatsApp tek tıkla; her iki durumda da Ulak taslağı yazar ve Timurhan onaylar. Bu V-44'ün demo kısmının yerini alır.
- **V-58** Teklif PDF yazı tipi Noto Sans'tır (OFL), Latin ve Türkçe karakterlere göre önceden küçültülmüştür (~29 KB). PDF yaklaşık 40 KB tutar; pdf-lib'in kendi küçültmesi glif kaybettiği için kullanılmaz.
- **V-59** Operasyon varsayılanları (ayarlardan değişir): kurulum formu linki 30 gün açık; vadesi geçen ödeme 3 gün sonra Telegram'a bir kez bildirilir. Aylık tahsilatlar her sabah 09:05'te, aylık müşteri raporu taslakları her ayın 1'inde 09:20'de hazırlanır.
- **V-60** Playbook'larda tekrarlayan adımlar (Müşteri Yaşamı "aylık rapor") dizi motorunda atlanır; aylık raporu kendi zamanlayıcısı hazırlar. Kazanılmış firmanın dizisi bitince firma bekleme listesine düşmez, sıradaki adımı projeye aittir.
- **V-61** "Kabul edildi" derken ödeme yolu seçilir (kurulumsuz / kurulumlu; Özel projede tek seçenek). Proje başlangıcı kabul günüdür; sözleşme sonu taahhüt süresinin bitiminden bir gün öncedir. İlk aylık ödeme kabul günü, sonrakiler her ay aynı gün (en geç 28'i) vadelenir. Kurucu indirimi ilk aylara yansır.
- **V-62** Kurulum formu linki müşteriye, onaylı bir mesajla gider (şablon, model yok). Form bir kez gönderilir; sonra yalnızca panelden düzeltilir.
- **V-63** Claude Code promptu proje açılır açılmaz geçici olarak üretilir. Form gelince yapılandırma dosyası (`papi-config.json`) ve kontrol listesiyle birlikte yeniden üretilir. Müşterinin iletişim bilgileri prompta değil yapılandırma dosyasına girer.
- **V-64** Teslim edilen modüller aylık sayıları kişisel veri olmadan, projeye özel bir anahtarla Papi'ye gönderir. Aylık rapor yalnızca şablonla hazırlanır ve onayla gider.
- **V-65** Cevap asistanında mesajlar saklanmaz, yalnızca sayılır. Telefon ya da e-posta bırakan mesaj işletme sahibine Telegram'dan bildirilir; bu bildirim müşterinin kendi hesabında olur. `/chat` için Cloudflare hız sınırı kuralı önerilir.
- **V-66** Not araması şimdilik metin ve etiketle yapılır. Notların anlam araması (embedding), kişisel veri ayıklamasıyla Faz 6'da Papi'nin hafızasına bağlanır.
- **V-67** Gece vardiyası varsayılanları: bölge `Balıkesir`, sektörler klinik/emlak/oto/otel/eğitim/inşaat, gece en fazla
  2 OSM araması (30 dakikada bir) ve 10 taslak; taslak bütçesi dolunca dizi ilerletme sabaha kalır. Ayarlardan değişir.
- **V-68** Faz 5'teki sabit zamanlı işler (09:05 tahsilat kontrolü, ayın 1'i müşteri raporları) artık rutin
  (`odeme_gecikme`, `aylik_musteri_raporlari`); saatleri Rutinler ekranından değişir. 10 hazır rutin seed'de.
- **V-69** Kuyruktaki `unique` seçeneği iş **türüne** göre tekilleştirir; bu yüzden rutin çalıştırma ve cevap taslağı
  işleri `unique` kullanmaz (aksi halde aynı anda iki rutin/iki cevap kaybolurdu). Rutin aynı vakti iki kez
  çalıştırmaz: kuyruğa koyarken sıradaki zamana geçer.
- **V-70** İlk kez görülen (veya yeniden açılan / saati değişen) rutin hemen çalışmaz; yalnızca sıradaki zamanı
  hesaplanır.
- **V-71** OSM "yeni açılan işletme" sinyali: bir bölge×sektör ilk kez tarandığında bulunanlar sinyal sayılmaz (zaten
  vardılar); sonraki haftalık taramalarda yeni görünenler `new_opening` sinyali olur. Haftalık çalışmada en fazla 6
  bölge×sektör sorgusu (Overpass nezaketi), sıra döner.
- **V-72** Sinyal, açık (analiz edilmiş / bekleme / yeni) firmayı Sinyal playbook'una alır ve yeniden analiz/puanlama
  kuyruğa girer. Aynı değişiklik aynı ISO haftasında bir kez kaydedilir (fingerprint).
- **V-73** Kazanılmış müşteriye (projeye bağlı ya da aşaması `won` firmaya) ait notlar hiç embedding'e gitmez; diğer
  notlar kişisel veri ayıklanarak gömülür. Papi'nin `search_notes` aracı sonuçları da ayıklanmış döner.
- **V-74** Konum bir adres için bir kez aranır (bulunsun ya da bulunmasın, `geocoded_at`); adres değişirse yeniden
  aranır. Birikmiş adresler kovalanmaz: her Actions çalışmasında ≤20 adres (≈5 dk).
- **V-75** Kalem içerikleri onaydan sonra panelde paylaşıma hazır olur: X için önceden doldurulmuş paylaşım linki;
  LinkedIn ve Instagram'da önceden doldurma linki olmadığından "Metni kopyala + aç". "Paylaştım" ile kayda geçer.
- **V-76** Ölçütler: ilk cevap süresi = firma başına ilk gönderilen temastan sonraki ilk cevaba kadar geçen saat,
  firmaların medyanı. Kanal filtresi temas ve cevaplara uygulanır; görüşme/teklif/kazanım kanaldan bağımsız.
  GitHub Actions dakikaları API ile değil, GitHub ayarlarından izlenir.
- **V-77** Ziyaret rotası kuş uçuşu en yakın komşu sırasıdır (ücretsiz rota servisi yok); başlangıç noktası
  ayarlardan (`intelligence.home`). Yazdırılabilir sayfada kişi bilgisi yer almaz.
