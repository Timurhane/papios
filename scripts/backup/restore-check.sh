#!/usr/bin/env bash
# Restore test (K-17.5): restores a data dump into a throwaway Postgres built from our migrations and
# compares row counts with the manifest. Usage: restore-check.sh papi.dump manifest.json
set -euo pipefail
DUMP="$1"
MANIFEST="$2"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=../db/throwaway.sh
source "$ROOT/scripts/db/throwaway.sh"

start_throwaway_pg "${PGPORT_RESTORE:-54339}"
apply_schema

# Seeds and the stub's own rows are not data to restore: start from empty tables.
psql -At -f "$ROOT/scripts/backup/tables.sql" | while read -r t; do
  PGOPTIONS='-c session_replication_role=replica' psql_q -c "delete from $t"
done

# Triggers (audit, immutability, FKs) stay off while data is loaded, as in a real restore.
PGOPTIONS='-c session_replication_role=replica' pg_restore --data-only --no-owner --no-privileges \
  -n public -n app -d postgres "$DUMP"

fail=0
while read -r t; do
  want="$(node -e 'const m=require(process.argv[1]);const v=m[process.argv[2]];console.log(v===undefined?"missing":v)' "$(realpath "$MANIFEST")" "$t")"
  got="$(psql -Atc "select count(*) from $t")"
  if [ "$want" != "$got" ]; then
    echo "MISMATCH $t: manifest=$want restored=$got"
    fail=1
  fi
done < <(psql -At -f "$ROOT/scripts/backup/tables.sql")
[ $fail -eq 0 ] && echo "restore check: all table counts match" || exit 1
