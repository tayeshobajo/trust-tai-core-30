#!/bin/sh
# Isolated local PostgreSQL only. No production connection string is accepted.
set -eu
CMD_PG_BIN=${CMD_PG_BIN:-/opt/homebrew/opt/postgresql@17/bin}
for cmd in initdb pg_ctl psql; do
  if [ ! -x "$CMD_PG_BIN/$cmd" ]; then echo "Missing isolated PostgreSQL runtime: $CMD_PG_BIN/$cmd" >&2; exit 2; fi
done
CMD_TEST_ROOT=$(mktemp -d /tmp/cmd-task-db.XXXXXX)
CMD_SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cleanup() { "$CMD_PG_BIN/pg_ctl" -D "$CMD_TEST_ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf -- "$CMD_TEST_ROOT"; }
trap cleanup EXIT INT TERM
"$CMD_PG_BIN/initdb" -D "$CMD_TEST_ROOT/data" -A trust --no-locale >/dev/null
mkdir "$CMD_TEST_ROOT/socket"
"$CMD_PG_BIN/pg_ctl" -D "$CMD_TEST_ROOT/data" -l "$CMD_TEST_ROOT/log" -o "-c listen_addresses='' -k $CMD_TEST_ROOT/socket" start >/dev/null
"$CMD_PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$CMD_TEST_ROOT/socket" -d postgres -c 'create database cmd_task_manager_test' >/dev/null
"$CMD_PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$CMD_TEST_ROOT/socket" -d cmd_task_manager_test -f "$CMD_SCRIPT_DIR/policies.sql"
