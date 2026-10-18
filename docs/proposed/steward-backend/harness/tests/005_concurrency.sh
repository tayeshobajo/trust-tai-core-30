#!/usr/bin/env bash
# Two racing claims on the same run: exactly one may win.
set -euo pipefail
DB="$1"
HERE="$(cd "$(dirname "$0")" && pwd)"

psql "$DB" -v ON_ERROR_STOP=1 -q <<'SQL'
\set org_a '''11111111-1111-1111-1111-111111111111'''
\set user_owner '''aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'''
select steward_request_canonical_run(:org_a, '10000000-0000-0000-0000-000000000001',
  'prepare_brief', 'd0000000-0000-0000-0000-000000000099', 'race', '[]'::jsonb, :user_owner);
SQL

claim() {
  psql "$DB" -v ON_ERROR_STOP=1 -tA -c \
    "select coalesce((select id::text from steward_claim_canonical_run(
        (select id from steward_canonical_runs
          where client_operation_id = 'd0000000-0000-0000-0000-000000000099'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')), 'LOST')"
}

a=$(claim) & pa=$!
b=$(claim) & pb=$!
wait $pa; wait $pb

wins=$(printf '%s\n%s\n' "$a" "$b" | grep -vc LOST)
[ "$wins" -eq 1 ] || { echo "FAIL: expected exactly 1 winning claim, got $wins ($a / $b)"; exit 1; }
attempts=$(psql "$DB" -tA -c \
  "select attempts from steward_canonical_runs where client_operation_id = 'd0000000-0000-0000-0000-000000000099'")
[ "$attempts" = "1" ] || { echo "FAIL: attempts=$attempts, expected 1"; exit 1; }
echo "concurrency OK: one winner, attempts=1"
