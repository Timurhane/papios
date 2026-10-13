# Sourced by scripts that need a throwaway local Postgres with the Supabase stub and our migrations.
# Usage: start_throwaway_pg PORT  (sets PGHOST/PGPORT/PGUSER/PGDATABASE, stops and deletes on exit)
# Requires postgres 16+ server binaries and pgvector.

ROOT="${ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
PGBIN="${PGBIN:-$(pg_config --bindir 2>/dev/null || echo /usr/lib/postgresql/16/bin)}"

psql_q() { psql -v ON_ERROR_STOP=1 -q "$@"; }

start_throwaway_pg() {
  local port="$1"
  THROWAWAY_DATA="$(mktemp -d /tmp/papi-pg.XXXXXX)"
  RUN_AS=()
  if [ "$(id -u)" = "0" ]; then
    chown postgres "$THROWAWAY_DATA"
    RUN_AS=(runuser -u postgres --)
  fi
  trap stop_throwaway_pg EXIT
  "${RUN_AS[@]}" "$PGBIN/initdb" -D "$THROWAWAY_DATA" -U postgres --auth=trust >/dev/null
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$THROWAWAY_DATA" \
    -o "-p $port -k /tmp -c listen_addresses=127.0.0.1" -w start >/dev/null
  export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=postgres PGDATABASE=postgres
  psql_q -c "alter database postgres set search_path = \"\$user\", public, extensions"
}

stop_throwaway_pg() {
  "${RUN_AS[@]}" "$PGBIN/pg_ctl" -D "$THROWAWAY_DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$THROWAWAY_DATA"
}

apply_schema() {
  psql_q -f "$ROOT/scripts/db/supabase-stub.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do psql_q -f "$f"; done
}
