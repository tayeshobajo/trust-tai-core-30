-- Atomic verification: identity, digests, revision conflicts, immutability,
-- replay reauthorization, personal-task exclusion.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- owner

-- 1. Verify happy path: receipt + audit + status in one transaction, with
--    the produced task revision recorded on the receipt.
do $$
declare res jsonb; r public.steward_task_receipts; t public.steward_tasks; n integer;
begin
  res := public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 0, 'b1000000-0000-0000-0000-000000000001',
    'Reviewed the recorded outcome against the source.');
  perform public.test_assert((res->>'replayed')::boolean = false, 'fresh verify is not flagged replayed');
  r := jsonb_populate_record(null::public.steward_task_receipts, res->'receipt');
  perform public.test_assert(r.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'receipt actor from auth.uid');
  perform public.test_assert(r.task_revision_after = 1, 'receipt records produced revision');
  select * into t from public.steward_tasks where id = '10000000-0000-0000-0000-000000000001';
  perform public.test_assert(t.status = 'complete' and t.revision = 1 and t.completed_by = r.actor_id, 'task completed atomically');
  select count(*) into n from public.steward_task_audit
   where task_id = t.id and kind = 'verify' and receipt_id = r.id;
  perform public.test_assert(n = 1, 'audit row written in the same transaction');
end $$;

-- 2. Duplicate operation replays; same UUID with changed payload conflicts.
do $$
declare res jsonb; r public.steward_task_receipts; conflicted boolean := false;
begin
  res := public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 0, 'b1000000-0000-0000-0000-000000000001',
    'Reviewed the recorded outcome against the source.');
  perform public.test_assert((res->>'replayed')::boolean = true, 'duplicate verify is explicitly flagged replayed');
  r := jsonb_populate_record(null::public.steward_task_receipts, res->'receipt');
  perform public.test_assert(r.id is not null, 'duplicate verify replays receipt');
  begin
    perform public.steward_verify_task('11111111-1111-1111-1111-111111111111',
      '10000000-0000-0000-0000-000000000001', 0, 'b1000000-0000-0000-0000-000000000001',
      'A DIFFERENT note with the same operation UUID');
  exception when sqlstate 'P0002' then conflicted := true; end;
  perform public.test_assert(conflicted, 'reused operation UUID with changed payload conflicts');
end $$;

-- 3. Revision conflict and short evidence rejected.
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 99, 'b1000000-0000-0000-0000-000000000002',
    'Stale revision attempt with enough text') $q$, 'revision conflict rejected');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-000000000003', 'done') $q$,
  'short evidence rejected');

-- 4. Authority: member cannot verify the owner's task; viewer/inactive/
--    cross-org cannot verify at all; personal tasks are out of scope even
--    for their owner.
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000001',
    'Member trying to verify another user task') $q$, 'member without authority cannot verify');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000002',
    'Viewer trying to verify with enough text') $q$, 'viewer cannot verify');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000003',
    'Inactive trying to verify with enough text') $q$, 'inactive cannot verify');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select public.steward_verify_task('22222222-2222-2222-2222-222222222222',
    '10000000-0000-0000-0000-000000000001', 1, 'b2000000-0000-0000-0000-000000000004',
    'Cross-org verify attempt with enough text') $q$, 'cross-org verify rejected');
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000004', 0, 'b2000000-0000-0000-0000-000000000005',
    'Owner trying to verify their personal task') $q$,
  'personal task verification rejected');

-- 5. Replay reauthorization: after the task is reassigned to the member,
--    the ORIGINAL owner replaying their old operation UUID is denied —
--    the replay cannot bypass the ownership change.
reset role;
update public.steward_tasks
   set owner_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 where id = '10000000-0000-0000-0000-000000000002';
set role authenticated;
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
  '10000000-0000-0000-0000-000000000002', 0, 'b3000000-0000-0000-0000-000000000001',
  'Member verifies their newly owned task.');
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000002', 0, 'b3000000-0000-0000-0000-000000000009',
    'Previous owner replaying after reassignment') $q$,
  'replay after ownership change is reauthorized and denied');
reset role;
update public.steward_tasks
   set owner_user_id = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'
 where id = '10000000-0000-0000-0000-000000000002';

-- 6. Reopen preserves history; receipt and audit accumulate.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare res jsonb; r public.steward_task_receipts; t public.steward_tasks; n integer;
begin
  res := public.steward_reopen_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 1, 'b1000000-0000-0000-0000-000000000004',
    'Evidence turned out insufficient on review.');
  perform public.test_assert((res->>'replayed')::boolean = false, 'fresh reopen is not flagged replayed');
  r := jsonb_populate_record(null::public.steward_task_receipts, res->'receipt');
  perform public.test_assert(r.task_revision_after = 2, 'reopen receipt records produced revision');
  select * into t from public.steward_tasks where id = '10000000-0000-0000-0000-000000000001';
  perform public.test_assert(t.status = 'open' and t.revision = 2, 'reopen flips status with revision bump');
  perform public.test_assert(t.completion_evidence <> '' and t.completed_at is not null, 'reopen retains prior evidence');
  select count(*) into n from public.steward_task_audit where task_id = t.id;
  perform public.test_assert(n = 2, 'verify and reopen both present in audit');
end $$;

-- 7. Operation UUIDs are unique across verify AND reopen.
select public.test_denied($q$
  select public.steward_reopen_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 2, 'b1000000-0000-0000-0000-000000000001',
    'Reusing a verify operation UUID for reopen') $q$, 'cross-action operation reuse conflicts');

-- 8. Receipts/audit are immutable even for the table owner; direct writes
--    are denied to authenticated.
select public.test_denied($q$
  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id)
  values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    gen_random_uuid(), 'verify', 'forged receipt text', 'forged', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct receipt insert denied');
reset role;
select public.test_denied($q$
  update public.steward_task_audit set note = 'rewritten' where true $q$, 'audit update blocked by trigger');
select public.test_denied($q$
  delete from public.steward_task_receipts where true $q$, 'receipt delete blocked by trigger');
