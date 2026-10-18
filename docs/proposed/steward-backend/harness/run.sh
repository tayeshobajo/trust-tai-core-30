#!/usr/bin/env bash
# Isolated harness: disposable local PostgreSQL, fixture schema, proposed
# patches, assertion scripts, concurrency race, then rollback verification.
# Nothing here touches any hosted database.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PGDATA="${PGDATA:-/tmp/steward-pgdata}"
PORT="${PGPORT:-55444}"
LOG=/tmp/steward-pg.log
# The /usr/bin wrapper points initdb at a mismatched libdir; resolve the real store bin.
PGBIN="${PGBIN:-$(dirname "$(readlink -f "$(command -v initdb)")")}"

rm -rf "$PGDATA"
runuser -u lovable -- "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust >/dev/null
runuser -u lovable -- "$PGBIN/pg_ctl" -D "$PGDATA" -l "$LOG" -o "-p $PORT -k /tmp" -w start >/dev/null
trap 'runuser -u lovable -- "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true' EXIT

DB="host=/tmp port=$PORT user=postgres dbname=postgres"

psql "$DB" -v ON_ERROR_STOP=1 -q -f "$HERE/fixture.sql"
for up in "$HERE"/../0*.up.sql; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$up"
done

for t in "$HERE"/tests/00{1,2,3,4}*.sql; do
  echo "== $(basename "$t")"
  psql "$DB" -v ON_ERROR_STOP=1 -q \
    -v org_a="'11111111-1111-1111-1111-111111111111'" \
    -v org_b="'22222222-2222-2222-2222-222222222222'" \
    -v user_owner="'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'" \
    -v user_member="'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'" \
    -v user_outsider="'cccccccc-cccc-cccc-cccc-cccccccccccc'" \
    -v conv_1="'dddddddd-dddd-dddd-dddd-dddddddddddd'" \
    -v prop_1="'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'" \
    -v prop_2="'ffffffff-ffff-ffff-ffff-ffffffffffff'" \
    -f "$t"
done

echo "== 005_concurrency.sh"
bash "$HERE/tests/005_concurrency.sh" "$DB"

echo "== rollback"
for down in "$HERE"/../0*.down.sql; do
  psql "$DB" -v ON_ERROR_STOP=1 -q -f "$down"
done
left=$(psql "$DB" -tA -c "select count(*) from pg_tables where tablename like 'steward\_canonical\_runs' or tablename like 'steward\_task\_receipts' or tablename like 'steward\_task\_audit' or tablename like 'steward\_coverage\_attestations' or tablename like 'steward\_proposal\_links'")
[ "$left" = "0" ] || { echo "FAIL: rollback left $left tables"; exit 1; }
echo "rollback OK: all proposed tables removed"
echo "ALL HARNESS CHECKS PASSED"
