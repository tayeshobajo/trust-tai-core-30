-- Atomic verification and reopen semantics.

-- 1. Short evidence is rejected.
do $$
begin
  perform steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 1, 'b0000000-0000-0000-0000-000000000001', 'done', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'expected evidence_required';
exception when sqlstate 'P0010' then null;
end $$;

-- 2. Wrong revision conflicts and writes nothing.
do $$
declare n integer;
begin
  perform steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 99, 'b0000000-0000-0000-0000-000000000002', 'checked the delivered mockup against the brief', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'expected revision_conflict';
exception when sqlstate 'P0011' then
  select count(*) into n from steward_task_receipts;
  assert n = 0, 'conflict must not write a receipt';
end $$;

-- 3. Non-owner cannot verify; cross-org task inaccessible.
do $$
begin
  perform steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 1, 'b0000000-0000-0000-0000-000000000003', 'checked the delivered mockup against the brief', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  raise exception 'expected not_authorized';
exception when sqlstate 'P0004' then null;
end $$;
do $$
begin
  perform steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003', 1, 'b0000000-0000-0000-0000-000000000004', 'checked the delivered mockup against the brief', 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  raise exception 'expected task_not_found_or_inaccessible';
exception when sqlstate 'P0003' then null;
end $$;

-- 4. Happy path: receipt + audit + status change atomically; revision bumps.
do $$
declare r steward_task_receipts; t steward_tasks; a steward_task_audit;
begin
  r := steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 1, 'b0000000-0000-0000-0000-000000000005', 'checked the delivered mockup against the brief', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  select * into t from steward_tasks where id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert t.status = 'complete' and t.revision = 2, 'verify must complete and bump revision';
  select * into a from steward_task_audit where operation_id = 'b0000000-0000-0000-0000-000000000005';
  assert a.action = 'verify' and a.revision_before = 1 and a.revision_after = 2;
end $$;

-- 5. Duplicate operation replays the original receipt with no new audit row.
do $$
declare r steward_task_receipts; n integer;
begin
  r := steward_verify_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 2, 'b0000000-0000-0000-0000-000000000005', 'different note text here', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert r.note = 'checked the delivered mockup against the brief', 'replay must return the original receipt';
  select count(*) into n from steward_task_audit where operation_id = 'b0000000-0000-0000-0000-000000000005';
  assert n = 1, 'replay must not append audit';
end $$;

-- 6. Reopen retains receipt and history, and appends a reopen entry.
do $$
declare e steward_task_audit; t steward_tasks; n integer;
begin
  e := steward_reopen_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 2, 'b0000000-0000-0000-0000-000000000006', 'client asked for a changed scope after review', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  select * into t from steward_tasks where id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert t.status = 'open' and t.revision = 3;
  select count(*) into n from steward_task_receipts where task_id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert n = 1, 'reopen must retain prior receipts';
  select count(*) into n from steward_task_audit where task_id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert n = 2, 'reopen must append, not replace, history';
end $$;

-- 7. Reopen of an unverified task is rejected.
do $$
begin
  perform steward_reopen_task('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002', 1, 'b0000000-0000-0000-0000-000000000007', 'trying to reopen an open task now', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  raise exception 'expected not_verified';
exception when sqlstate 'P0013' then null;
end $$;
