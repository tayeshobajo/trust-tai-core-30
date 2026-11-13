#!/usr/bin/env bash
set -euo pipefail
ROOT=$(mktemp -d /tmp/hiring-notification-pg.XXXXXX)
chmod 755 "$ROOT"
mkdir "$ROOT/socket" "$ROOT/data"
if [ "$(id -u)" = 0 ]; then
  chown -R lovable "$ROOT"
  PG_RUN=(setpriv --reuid=1000 --regid=1000 --clear-groups)
else
  PG_RUN=()
fi
trap '"${PG_RUN[@]}" pg_ctl -D "$ROOT/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$ROOT"' EXIT
"${PG_RUN[@]}" initdb -D "$ROOT/data" -U postgres --auth=trust --no-locale --encoding=UTF8 >/dev/null
"${PG_RUN[@]}" pg_ctl -D "$ROOT/data" -l "$ROOT/log" -o "-c listen_addresses='' -k $ROOT/socket" -w start >/dev/null
DB="host=$ROOT/socket user=postgres dbname=postgres"
psql "$DB" -X -v ON_ERROR_STOP=1 -f qa/hiring-notifications/fixture.sql
psql "$DB" -X -v ON_ERROR_STOP=1 -f docs/hiring/notifications.pending.sql
psql "$DB" -X -v ON_ERROR_STOP=1 -f qa/hiring-notifications/assertions.sql
echo 'Isolated additive SQL checks passed; hosted schema and queue contracts unverified.'