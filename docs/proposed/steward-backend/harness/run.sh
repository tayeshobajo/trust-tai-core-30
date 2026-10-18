#!/usr/bin/env bash
# Isolated disposable PostgreSQL harness for the UNAPPLIED Steward backend
# proposals. Safety properties:
#  - PGDATA is always a fresh mktemp directory owned by this script; no
#    externally supplied path is ever deleted.
#  - listen_addresses='' — no network listener; Unix socket inside the
#    private mktemp directory only.
#  - Runs as a non-root user (drops privileges via runuser when root).
#  - Portable across Linux and macOS: override the PostgreSQL bin directory
#    with CMD_PG_BIN (default: autodetect from initdb on PATH).
set -euo pipefail

if [ -n "${CMD_PG_BIN:-}" ]; then
  PGBIN="$CMD_PG_BIN"
else
  PGBIN="$(dirname "$(readlink -f "$(command -v initdb)")")"
fi
for cmd in initdb pg_ctl psql postgres; do
  [ -x "$PGBIN/$cmd" ] || { echo "missing $PGBIN/$cmd" >&2; exit 2; }
done

ROOT="$(mktemp -d /tmp/steward-backend-test.XXXXXX)"
SOCKET="$ROOT/socket"
mkdir -p "$SOCKET"
LOG="$ROOT/pg.log"

AS_USER=""
if [ "$(id -u)" = "0" ]; then
  # Drop to an unprivileged user; PostgreSQL refuses to run as root.
  AS_USER="runuser -u lovable --"
  chown -R lovable:lovable "$ROOT"
fi

cleanup() {
  $AS_USER "$PGBIN/pg_ctl" -D "$ROOT/data" -m immediate stop >/dev/null 2>&1 || true
  rm -rf -- "$ROOT"
}
trap cleanup EXIT INT TERM

$AS_USER "$PGBIN/initdb" -D "$ROOT/data" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
$AS_USER "$PGBIN/pg_ctl" -D "$ROOT/data" -l "$LOG" -o "-c listen_addresses='' -k $SOCKET" -w start >/dev/null

DB="host=$SOCKET user=postgres dbname=postgres"
export TMPDIR_A="$ROOT/claim_a" TMPDIR_B="$ROOT/claim_b"

echo "== fixture"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$(dirname "$0")/fixture.sql"

HERE="$(cd "$(dirname "$0")" && pwd)"
for f in "$HERE"/../0*.up.sql; do
  echo "== apply $(basename "$f")"
  psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done

echo "== 000_acl_pregrant.sql"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/tests/000_acl_pregrant.sql"

# Grants are applied locally ONLY so the restricted-role tests can exercise
# the functions; grants.review.sql stays unapplied on any real project.
echo "== grants.review.sql (local harness only)"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/../grants.review.sql"

echo "== 000b_acl_postgrant.sql"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/tests/000b_acl_postgrant.sql"

for t in "$HERE"/tests/00[1-5]*.sql "$HERE"/tests/008_journey.sql "$HERE"/tests/009_score_snapshot.sql; do
  echo "== $(basename "$t")"
  psql "$DB" -q -v ON_ERROR_STOP=1 -f "$t"
done

echo "== 006_concurrency.sh"
bash "$HERE/tests/006_concurrency.sh" "$DB"

echo "== 007_adapter_journey.sh"
bash "$HERE/tests/007_adapter_journey.sh" "$DB"

echo "== rollback (data-preserving)"
for f in "$HERE"/../00*.down.sql; do
  psql "$DB" -q -v ON_ERROR_STOP=1 -f "$f"
done
echo "== 007_rollback.sql"
psql "$DB" -q -v ON_ERROR_STOP=1 -f "$HERE/tests/007_rollback.sql"

echo "ALL HARNESS CHECKS PASSED"
