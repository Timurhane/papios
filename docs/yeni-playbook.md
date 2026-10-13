# Yeni playbook ekleme (K-11)

Playbook = adım listesi. Motor (`packages/server/src/services/ulak.ts`) her adımı sırayla işler; mesaj üreten her
adım onay kuyruğuna taslak düşer (tek istisna analiz aracı raporu, K-2.2). Kod değişikliği gerekmez.

## 1. Tanımı yaz

`supabase/seed/40_playbooks.sql` dosyasına (ya da yeni bir seed dosyasına) iki ekleme:

```sql
insert into public.playbooks (tenant_id, code, name, description, trigger, duration_days) values
  ('00000000-0000-4000-8000-00000000a1a0', 'fuar_sonrasi', 'Fuar Sonrası',
   'Fuarda tanışılan işletmeler için kısa takip.', 'manual', 10)
on conflict (tenant_id, code) do nothing;

-- adımlar: (kod, sıra, gün, çapa, tekrar, kanal, açı, koşullar, onay gerekir mi, onay istisnası)
  ('fuar_sonrasi', 1, 0, 'start', null, 'whatsapp', 'Fuardaki sohbete atıf, teşekkür', '{"requires": ["phone"]}', true, null),
  ('fuar_sonrasi', 2, 3, 'start', null, 'email', 'Konuştuğumuz konuya somut örnek', '{"requires": ["email"]}', true, null),
  ('fuar_sonrasi', 3, 7, 'start', null, 'phone_call', 'Kısa arama', '{"requires": ["phone"]}', false, null)
```

- **Kanallar:** `email`, `whatsapp`, `instagram_dm`, `linkedin`, `x`, `phone_call`, `visit`, `demo`.
- **Koşullar:** `requires` listesi (`email`, `phone`, `instagram`, `linkedin`); bilgi yoksa adım atlanır.
- **Onay:** mesaj kanallarında `true` olmalı. `phone_call` / `visit` görevdir, onay istemez.
- **Çapa:** `start` (diziye giriş günü) veya `contract_end` (Müşteri Yaşamı gibi sözleşme tarihine bağlı diziler).
- **Açı:** taslağı yazan modele verilen tek cümlelik yön; kişisel veri içermez.

## 2. Uygula ve test et

1. Yerelde: `bash scripts/test-db-local.sh` (seed tutarlılık testleri `supabase/tests/database/40_seed.test.sql`).
2. Canlıda: Actions → "DB deploy" → `include_seed` işaretli çalıştır. Seed tekrar çalıştırılabilir; mevcut
   playbook'ların üzerine yazmaz.
3. Firmayı yeni diziye almak: CRM'de firma kartı → Sıradaki adım → Playbook seç.

## 3. Otomatik giriş (isteğe bağlı)

Puan/sinyal ile otomatik giriş istenirse `packages/core/src/analysis/scoring.ts` içindeki playbook seçimine yeni
bir kural eklenir (önce kural, sonra model — K-2.3) ve `scoring.test.ts`'ye test yazılır.

Papi öğrenme rutininde playbook adım performansından değişiklik **önerir** (K-11.6); öneriyi onaylamadıkça hiçbir
adım değişmez.
