#!/usr/bin/env bash
set -euo pipefail
export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"
TEST_ROOT=$(mktemp -d /tmp/steward-approved-pg.XXXXXX)
mkdir "$TEST_ROOT/socket"
trap 'pg_ctl -D "$TEST_ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$TEST_ROOT"' EXIT
initdb -D "$TEST_ROOT/data" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
pg_ctl -D "$TEST_ROOT/data" -l "$TEST_ROOT/log" -o "-c listen_addresses='' -k $TEST_ROOT/socket" -w start >/dev/null
export STEWARD_TEST_DB="host=$TEST_ROOT/socket user=postgres dbname=postgres"
psql "$STEWARD_TEST_DB" -q -v ON_ERROR_STOP=1 -f qa/steward/persistence/fixture.sql
node_modules/.bin/vitest run --config qa/steward/persistence/vitest.config.ts
