#!/usr/bin/env bash
# Local proof that a backup restores: seeded source DB → dump.sh → restore-check.sh (fresh DB).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../db/throwaway.sh
source "$ROOT/scripts/db/throwaway.sh"
OUT="$(mktemp -d /tmp/papi-backup.XXXXXX)"

start_throwaway_pg "${PGPORT_SOURCE:-54349}"
apply_schema
for f in "$ROOT"/supabase/seed/*.sql; do psql_q -f "$f"; done
psql_q -c "insert into public.companies (tenant_id, name, name_norm, source, waiting_reason, waiting_until)
           values ('00000000-0000-4000-8000-00000000a1a0', 'Yedek Test', 'yedek test', 'manual', 'x', current_date)"
"$ROOT/scripts/backup/dump.sh" "$OUT"
( unset PGHOST PGPORT PGUSER PGDATABASE; "$ROOT/scripts/backup/restore-check.sh" "$OUT/papi.dump" "$OUT/manifest.json" )
rm -rf "$OUT"
