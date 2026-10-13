#!/usr/bin/env bash
# Runs supabase/tests on a throwaway local Postgres with a Supabase stub (no Docker needed).
# Requires: postgres 16+ binaries, pgvector, pgTAP and pg_prove.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=db/throwaway.sh
source "$ROOT/scripts/db/throwaway.sh"

start_throwaway_pg "${PGPORT_TEST:-54329}"
apply_schema
for f in "$ROOT"/supabase/seed/*.sql; do psql_q -f "$f"; done
psql_q -c "create extension if not exists pgtap with schema extensions"

pg_prove --ext .sql -r "$ROOT/supabase/tests"
