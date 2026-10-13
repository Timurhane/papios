#!/usr/bin/env bash
# Nightly data backup (K-17.5). Usage: dump.sh OUT_DIR   (connection from PG* env or SUPABASE_DB_URL)
# Writes OUT_DIR/papi.dump (pg_dump custom format, data only: public + app), OUT_DIR/auth.dump (login
# accounts and TOTP factors) and OUT_DIR/manifest.json (row counts per table, no data) for the restore check.
set -euo pipefail
OUT="$1"
mkdir -p "$OUT"
DB=()
[ -n "${SUPABASE_DB_URL:-}" ] && DB=(-d "$SUPABASE_DB_URL")
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

AUTH_TABLES=()
for t in auth.users auth.identities auth.mfa_factors; do
  if [ "$(psql "${DB[@]}" -Atc "select to_regclass('$t') is not null")" = "t" ]; then
    AUTH_TABLES+=(-t "$t")
  fi
done

pg_dump "${DB[@]}" --format=custom --data-only --no-owner --no-privileges \
  -n public -n app -f "$OUT/papi.dump"
# -t selects only the listed tables, so auth goes into its own file.
if [ ${#AUTH_TABLES[@]} -gt 0 ]; then
  pg_dump "${DB[@]}" --format=custom --data-only --no-owner --no-privileges \
    "${AUTH_TABLES[@]}" -f "$OUT/auth.dump"
fi

# Row counts, so a restore can be checked without reading any data.
{
  echo '{'
  first=1
  while read -r t; do
    n="$(psql "${DB[@]}" -Atc "select count(*) from $t")"
    [ $first -eq 1 ] || echo ','
    printf '  "%s": %s' "$t" "$n"
    first=0
  done < <(psql "${DB[@]}" -At -f "$ROOT/scripts/backup/tables.sql")
  echo
  echo '}'
} > "$OUT/manifest.json"
echo "dump: $(du -h "$OUT/papi.dump" | cut -f1), tables: $(grep -c '"' "$OUT/manifest.json")"
