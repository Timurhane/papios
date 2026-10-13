# Geliştirme ortamı

## Gerekenler

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable`)
- [gitleaks](https://github.com/gitleaks/gitleaks) — commit öncesi gizli bilgi taraması için zorunlu
  (yoksa pre-commit kancası commit'i durdurur)
- Docker (yerel Supabase için) **veya** Postgres 16 + `pgvector` + `pgTAP` + `pg_prove`
  (`pnpm test:db:local` için)

## İlk kurulum

```bash
pnpm install            # lefthook kancalarını da kurar
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

## Yerel Supabase (Docker ile)

```bash
pnpm exec supabase start      # migration + seed uygulanır
pnpm exec supabase status     # URL ve publishable (anon) anahtarı → apps/web/.env.local
pnpm test:db
```

Yerel kullanıcı: Studio (http://127.0.0.1:54323) → Authentication → Add user, sonra SQL:
`select app.attach_owner('ajna', '<e-posta>');`. Panel: `pnpm --filter @papi/web dev`.

## Docker yoksa

```bash
pnpm test:db:local    # geçici bir Postgres açar, Supabase taklidi + migration + seed + pgTAP
```

## Ayar eklemek

1. `packages/core/src/settings/schema.ts` içine anahtarı ve Zod şemasını ekle.
2. `defaults.ts` içine varsayılanı ekle.
3. `pnpm gen:seed` → `supabase/seed/20_settings.sql` güncellenir (güncel değilse test kırılır).
