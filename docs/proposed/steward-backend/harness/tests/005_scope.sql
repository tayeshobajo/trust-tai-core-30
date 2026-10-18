-- Scope membership: durable denominator, archive retention, audited
-- amendments, revision-bound verification credit, pending-proposal gating,
-- required-manual sync, no false 100 from deletion or partial reads.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. Add required items (transcript + manual_required + archived task).
do $$
declare i public.steward_scope_items;
begin
  i := public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000001',
    'transcript', 'd1000000-0000-0000-0000-000000000001');
  perform public.test_assert(i.added_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'scope add actor from auth.uid');
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd1000000-0000-0000-0000-000000000002');
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000003',
    'manual_required', 'd1000000-0000-0000-0000-000000000003');
end $$;

-- 2. Counts: denominator 4 including the ARCHIVED task (3 added here + 1
--    from the coverage suite); verified 1 — task 2 was verified in 002 and
--    its revision still matches, while task 1 was verified then reopened
--    and earns nothing; one pending ledger proposal gates 100.
do $$
declare c record;
begin
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.denominator = 4, 'archived required task stays in the denominator');
  perform public.test_assert(c.verified = 1, 'only the still-valid verification counts');
  perform public.test_assert(c.pending_proposals = 1, 'unlinked ledger proposal counts as pending');
end $$;

-- 3. Verify task 1; counts move honestly; archived open task still
--    blocks 100.
do $$
declare c record;
begin
  perform public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 2, 'd2000000-0000-0000-0000-000000000001',
    'Verified the handoff outcome against the recording.');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.denominator = 4 and c.verified = 2, 'two of four verified');
end $$;

-- 3b. Revision-bound credit: a later task edit (revision bump) drops the
--     verification credit even though status stays complete, and a legacy
--     status flip after reopen cannot regain it.
reset role;
update public.steward_tasks set title = title || ' (edited)', revision = revision + 1
 where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare c record;
begin
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.verified = 1, 'post-verify edit drops only that task credit');
end $$;
reset role;
update public.steward_tasks set title = 'Prepare Soji handoff' where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 4. Idempotent add replay; changed payload with same UUID conflicts;
--    duplicate task in scope conflicts; personal task rejected.
do $$
declare i public.steward_scope_items;
begin
  i := public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000001',
    'transcript', 'd1000000-0000-0000-0000-000000000001');
  perform public.test_assert(i.id is not null, 'same add operation replays');
end $$;
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000001',
    'manual_required', 'd1000000-0000-0000-0000-000000000001') $q$,
  'reused add UUID with changed classification conflicts');
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000001',
    'transcript', 'd1000000-0000-0000-0000-000000000099') $q$,
  'duplicate task in scope conflicts');
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000004',
    'manual_required', 'd1000000-0000-0000-0000-000000000004') $q$,
  'personal task cannot enter required scope');

-- 5. Scope changes invalidate coverage: attest, then add an item.
do $$
begin
  perform public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'coverage valid before scope change');
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000006',
    'manual_required', 'd1000000-0000-0000-0000-000000000006');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'scope add invalidates coverage');
end $$;

-- 5b. Required-manual sync: seeds the correlation-keyed task idempotently.
do $$
declare added integer;
begin
  -- Task 6 is already in scope from 5, so the sync adds nothing new but
  -- must not fail or duplicate.
  added := public.steward_scope_sync_required('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd5000000-0000-0000-0000-000000000001');
  perform public.test_assert(added = 0, 'sync is idempotent over existing scope');
end $$;

-- 6. Explicit audited amendment removes from denominator with a reason;
--    short reason rejected; amendment bumps scope version.
do $$
declare i public.steward_scope_items; c record; v integer; n integer;
begin
  select * into i from public.steward_scope_items
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and task_id = '10000000-0000-0000-0000-000000000006';
  i := public.steward_scope_amend_remove('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', i.id,
    'Human review decided this item is out of scope.', 'd3000000-0000-0000-0000-000000000001');
  perform public.test_assert(i.removed_at is not null, 'amendment marks removal');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.denominator = 4, 'amended item leaves the denominator');
  select count(*) into n from public.steward_scope_audit
   where scope_item_id = i.id and kind = 'amend_remove';
  perform public.test_assert(n = 1, 'amendment audited');
  select version into v from public.steward_scope_versions
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(v >= 3, 'amendment bumps scope version');
end $$;
select public.test_denied($q$
  select public.steward_scope_amend_remove('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select id from public.steward_scope_items
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and task_id = '10000000-0000-0000-0000-000000000002'),
    'no', 'd3000000-0000-0000-0000-000000000002') $q$,
  'short amendment reason rejected');

-- 7. Authority: viewer/inactive/cross-org cannot add or amend.
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd4000000-0000-0000-0000-000000000001') $q$, 'viewer cannot add scope');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd4000000-0000-0000-0000-000000000002') $q$, 'inactive cannot add scope');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
do $$
declare c record;
begin
  select * into c from public.steward_scope_counts('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.denominator = 0, 'cross-org counts see nothing');
end $$;

-- 8. Scope rows cannot be deleted or directly mutated — no false 100 via
--    disappearance.
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  delete from public.steward_scope_items where true $q$, 'scope delete disabled');
select public.test_denied($q$
  update public.steward_scope_items set removed_at = now() where true $q$,
  'direct scope update denied (function-only mutation)');
select public.test_denied($q$
  insert into public.steward_scope_items
    (organization_id, conversation_id, task_id, classification, operation_id, request_digest, added_by)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    '10000000-0000-0000-0000-000000000002', 'manual_required', gen_random_uuid(), 'forged',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$, 'direct scope insert denied');
reset role;
