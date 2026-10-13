# Yedekten geri yükleme (K-17.5, K-17.9)

## Yedek nasıl alınır

- Her gece 04:23'te (İstanbul) `.github/workflows/backup.yml` çalışır.
- `public` ve `app` şemalarının **verisi** (`papi.dump`), giriş hesapları ve TOTP kayıtları (`auth.dump`) ve tablo
  başına satır sayıları (`manifest.json`, veri içermez) alınır.
- Üçü tek bir dosyada `age` ile şifrelenir: `papi-YYYY-MM-DD.tar.age`. Şifre çözmek için gereken gizli anahtar
  **yalnızca sende** durur; repoda yalnızca açık anahtar (`ops/backup/age-recipients.txt`) vardır.
- Dosya GitHub Actions artifact olarak saklanır: günlük yedekler 30 gün, ayın 1'indeki yedek 90 gün.
- Her pazar yedek, migration'lardan kurulan boş bir Postgres'e geri yüklenir ve tablo sayıları karşılaştırılır
  (şifrelemeden önce). Sonuç Telegram'a gelir; başarısız gece yedeği de Telegram'a bildirilir.

Şema (tablolar, fonksiyonlar, RLS) yedekte değil, repodaki `supabase/migrations` klasöründedir. Geri yükleme
"önce şema, sonra veri" sırasıyla yapılır.

## Bir kerelik kurulum (masaüstü oturumu)

1. Bilgisayarına `age` kur (macOS: `brew install age`, Windows: `winget install FiloSottile.age`).
2. Anahtar çifti üret: `age-keygen -o papi-yedek-anahtari.txt`
   - Çıktıdaki `Public key: age1...` satırı **açık anahtardır**: `ops/backup/age-recipients.txt` dosyasının
     sonuna `age1...` olarak eklenir (Claude ekler, sen değeri söylersin; açık anahtar gizli değildir).
   - `papi-yedek-anahtari.txt` dosyası **gizli anahtardır**: parola yöneticine ve bir USB belleğe koy. Repoya,
     sohbete, GitHub'a asla girmez. Kaybolursa yedekler açılamaz.
3. Supabase → Project Settings → Database → **Connection string** → "Session pooler" (IPv4) adresini kopyala;
   şifre kısmına veritabanı şifreni yaz. GitHub → repo → Settings → Secrets → Actions → `SUPABASE_DB_URL`.
4. Actions → "Nightly backup" → **Run workflow** (geri yükleme testi işaretli). Yeşil biterse kurulum tamamdır.

## Geri yükleme

1. GitHub → Actions → "Nightly backup" → istediğin günün çalışması → **Artifacts** → `papi-backup-...` indir, aç.
2. Şifreyi çöz ve dosyaları çıkar:
   ```bash
   age -d -i papi-yedek-anahtari.txt papi-YYYY-MM-DD.tar.age | tar -xf -
   ```
3. Hedef veritabanını hazırla:
   - **Aynı proje bozulduysa:** Supabase'de yeni proje aç (ya da mevcut projede tabloları boşalt).
   - Repoda: `supabase link --project-ref <yeni-ref>` ve `supabase db push` (migration'lar = şema).
   - Seed **çalıştırma**; ayarlar yedekten gelecek.
4. Veriyi yükle (Postgres 17 araçlarıyla; `SUPABASE_DB_URL` yeni projenin session pooler adresi):
   ```bash
   # tetikleyiciler (audit, değiştirilemezlik) ve FK kontrolleri yükleme sırasında kapalı
   export PGOPTIONS='-c session_replication_role=replica'
   pg_restore --data-only --no-owner --no-privileges -d "$SUPABASE_DB_URL" auth.dump
   pg_restore --data-only --no-owner --no-privileges -n public -n app -d "$SUPABASE_DB_URL" papi.dump
   ```
   Seed ya da `supabase db push` bazı satırları zaten eklediyse önce o tabloları boşalt; çakışan satır hatası
   alırsan aynı komutu `--clean` olmadan, ilgili tabloyu `truncate` edip yeniden çalıştır.
5. Doğrula: `manifest.json`'daki sayılar ile `select count(*)` sonuçları aynı olmalı. Yerelde aynı kontrol:
   `scripts/backup/restore-check.sh papi.dump manifest.json`.
6. Worker ve panelin yeni projeyi göstermesi için `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (GitHub secrets) ve
   panelin `VITE_SUPABASE_*` değerlerini güncelle, API ve panel deploy iş akışlarını çalıştır.

## Yerel deneme

Docker gerekmez: `bash scripts/backup/selftest.sh` seed'li bir veritabanını yedekleyip boş bir veritabanına geri
yükler ve sayıları karşılaştırır (CI'da her push'ta değil, elle çalıştırılır).
