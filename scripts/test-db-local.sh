#!/usr/bin/env bash
# Runs supabase/tests on a throwaway local Postgres with a Supabase stub (no Docker needed).
# Requires: postgres 16+ binaries, pgvector, pgTAP and pg_prove.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"
PORT="${PGPORT_TEST:-54329}"
DATA="$(mktemp -d /tmp/papi-pg.XXXXXX)"
RUN_AS=()
if [ "$(id -u)" = "0" ]; then
  chown postgres "$DATA"
  RUN_AS=(runuser -u postgres --)
fi

cleanup() {
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

"${RUN_AS[@]}" "$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null
"${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$DATA" -o "-p $PORT -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null

export PGHOST=127.0.0.1 PGPORT="$PORT" PGUSER=postgres PGDATABASE=postgres
psql_q() { psql -v ON_ERROR_STOP=1 -q "$@"; }

psql_q -c "alter database postgres set search_path = \"\$user\", public, extensions"
psql_q -f "$ROOT/scripts/db/supabase-stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do psql_q -f "$f"; done
for f in "$ROOT"/supabase/seed/*.sql; do psql_q -f "$f"; done
psql_q -c "create extension if not exists pgtap with schema extensions"

pg_prove --ext .sql -r "$ROOT/supabase/tests"
