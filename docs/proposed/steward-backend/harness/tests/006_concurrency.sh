#!/usr/bin/env bash
# Racing claims on the same run: exactly one winner, and the loser's stale
# fencing token cannot complete. Also: concurrent duplicate requests replay
# reliably instead of erroring.
set -euo pipefail
DB="$1"

AS_OWNER=$(cat <<'SQL'
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
SQL
)

psql "$DB" -q -v ON_ERROR_STOP=1 -o /dev/null <<SQL
$AS_OWNER
select public.steward_request_canonical_run(
  '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002',
  'prepare_brief', 'd0000000-0000-0000-0000-000000000099',
  '[{"kind":"task_notes","id":"10000000-0000-0000-0000-000000000002"}]'::jsonb);
SQL

claim() {
  psql "$DB" -v ON_ERROR_STOP=1 -tA <<'SQL' 2>/dev/null
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select coalesce((select (claim_token)::text from public.steward_claim_canonical_run(
    (select id from public.steward_canonical_runs
      where client_operation_id = 'd0000000-0000-0000-0000-000000000099'))), 'LOST');
SQL
}

claim > "$TMPDIR_A" & pa=$!
claim > "$TMPDIR_B" & pb=$!
wait $pa; wait $pb
a=$(cat "$TMPDIR_A"); b=$(cat "$TMPDIR_B")

wins=$(printf '%s\n%s\n' "$a" "$b" | grep -vc LOST || true)
[ "$wins" -eq 1 ] || { echo "FAIL: expected exactly 1 winning claim, got $wins ($a / $b)"; exit 1; }

winner=$(printf '%s\n%s\n' "$a" "$b" | grep -v LOST | head -1)
loser=$(printf '%s\n%s\n' "$a" "$b" | grep LOST | head -1)
[ "$loser" = "LOST" ] || { echo "FAIL: expected one LOST claim"; exit 1; }

# The winner's token completes; a fabricated/stale token cannot.
psql "$DB" -q -v ON_ERROR_STOP=1 -o /dev/null <<SQL
$AS_OWNER
select public.steward_complete_canonical_run(
  (select id from public.steward_canonical_runs where client_operation_id = 'd0000000-0000-0000-0000-000000000099'),
  '$winner'::uuid, 'race winner artifact');
do \$\$
begin
  begin
    perform public.steward_complete_canonical_run(
      (select id from public.steward_canonical_runs where client_operation_id = 'd0000000-0000-0000-0000-000000000099'),
      gen_random_uuid(), 'stale artifact');
    raise exception 'FAILED: fabricated token completed';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  perform public.test_assert(true, 'fabricated fencing token cannot complete');
end \$\$;
SQL

attempts=$(psql "$DB" -tA -c \
  "select attempts from public.steward_canonical_runs where client_operation_id = 'd0000000-0000-0000-0000-000000000099'")
[ "$attempts" = "1" ] || { echo "FAIL: attempts=$attempts, expected 1"; exit 1; }

# Concurrent duplicate requests: both succeed, one row, identical digest.
request() {
  psql "$DB" -q -v ON_ERROR_STOP=1 -o /dev/null <<'SQL' 2>/dev/null
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.steward_request_canonical_run(
  '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002',
  'prepare_brief', 'd0000000-0000-0000-0000-000000000098',
  '[{"kind":"task_notes","id":"10000000-0000-0000-0000-000000000002"}]'::jsonb);
SQL
}
request & ra=$!
request & rb=$!
wait $ra; wait $rb
rows=$(psql "$DB" -tA -c \
  "select count(*) from public.steward_canonical_runs where client_operation_id = 'd0000000-0000-0000-0000-000000000098'")
[ "$rows" = "1" ] || { echo "FAIL: concurrent duplicate request created $rows rows"; exit 1; }

echo "concurrency OK: one claim winner, fencing enforced, duplicate request replayed"
