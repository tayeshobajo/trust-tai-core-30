-- Scope membership: durable denominator, archive retention, audited
-- amendments, revision-bound verification credit, pending-proposal gating,
-- required-manual sync, no false 100 from deletion or partial reads.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. Add required items (manual_required + archived task). Task 1 is
--    ALREADY in scope: the 004 link added it atomically as 'transcript'.
--    Re-adding it must conflict, not duplicate.
do $$
declare i public.steward_scope_items;
begin
  perform public.test_assert(exists(
    select 1 from public.steward_scope_items
     where organization_id = '11111111-1111-1111-1111-111111111111'
       and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
       and task_id = '10000000-0000-0000-0000-000000000001'
       and classification = 'transcript' and removed_at is null),
    'task 1 already in scope from the atomic proposal link');
  i := public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd1000000-0000-0000-0000-000000000002');
  perform public.test_assert(i.added_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'scope add actor from auth.uid');
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000003',
    'manual_required', 'd1000000-0000-0000-0000-000000000003');
end $$;
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000001',
    'manual_required', 'd1000000-0000-0000-0000-000000000009') $q$,
  're-adding the linked task conflicts, never duplicates');

-- 2. Counts: denominator 6 = 4 scope items (3 added here + 1 from the
--    coverage suite, INCLUDING the archived task) + 2 confirmed
--    commitments (commit-a open, commit-b done). The cancelled commitment
--    is excluded; the commitment sharing source_key ext-3948 with the
--    proposal linked to in-scope task 1 is excluded (no double count).
--    Verified 1 — task 2 was verified in 002 and its revision still
--    matches, while task 1 was verified then reopened and earns nothing;
--    commitments NEVER earn verified credit (no verification contract
--    exists for them yet), so commit-b's done status counts for nothing.
--    One pending ledger proposal gates 100.
do $$
declare c record;
begin
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.denominator = 6, 'archived task + confirmed commitments stay in the denominator');
  perform public.test_assert(c.verified = 1, 'only the still-valid verification counts; commitments earn no credit');
  -- 004 decided both ledger proposals (one linked, one dismissed), so
  -- nothing is pending here; pending gating is asserted separately below.
  perform public.test_assert(c.pending_proposals = 0, 'decided proposals are not pending');
end $$;

-- 2b. Pending-proposal gating: a newly registered (undecided) proposal
--     counts as pending and gates 100 until a human decides it.
do $$
declare c record; added integer; proposal_id uuid;
begin
  added := public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-000000000009',
    '[{"source_key":"ext-4103","kind":"action","statement":"Follow-up proposal at 41:03"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb);
  perform public.test_assert(added = 1, 'new proposal registered');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.pending_proposals = 1, 'undecided proposal gates 100');
  select id into proposal_id from public.steward_proposal_ledger
   where organization_id = '11111111-1111-1111-1111-111111111111' and source_key = 'ext-4103';
  perform public.steward_dismiss_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', proposal_id,
    'Reviewed: duplicate of the linked roadmap proposal.', 'c0000000-0000-0000-0000-00000000000a');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.pending_proposals = 0, 'decided proposal no longer gates');
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
  perform public.test_assert(c.denominator = 6 and c.verified = 2, 'two of six verified');
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
--    duplicate task in scope conflicts; personal task rejected. Task 2's
--    add operation (d1…002) is the replayable one; task 1 entered scope
--    via the 004 link operation, so a fresh add UUID on it must conflict.
do $$
declare i public.steward_scope_items;
begin
  i := public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd1000000-0000-0000-0000-000000000002');
  perform public.test_assert(i.id is not null, 'same add operation replays');
end $$;
select public.test_denied($q$
  select public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'transcript', 'd1000000-0000-0000-0000-000000000002') $q$,
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
  perform public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c5000000-0000-0000-0000-000000000000',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    coalesce((select version from public.steward_scope_versions
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 1));
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

-- 5b. Required-manual sync: discovers the real-format correlation-keyed
--     task (cmd-meeting-required:v1:<meetingUUID>:<opUUID>) that was never
--     explicitly added, then replays idempotently. Task 6 is already in
--     scope from 5, so only task 0a is new.
do $$
declare added integer; added2 integer;
begin
  added := public.steward_scope_sync_required('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd5000000-0000-0000-0000-000000000001');
  perform public.test_assert(added = 1, 'sync discovers the real-format correlation-keyed task');
  perform public.test_assert(exists (
    select 1 from public.steward_scope_items
     where task_id = '10000000-0000-0000-0000-00000000000a'
       and classification = 'manual_required'),
    'synced task enters scope as manual_required');
  added2 := public.steward_scope_sync_required('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'd5000000-0000-0000-0000-000000000002');
  perform public.test_assert(added2 = 0, 'sync replay is idempotent over existing scope');
  -- Parser contract: the legacy slash-key task 7 and the other-meeting
  -- task 8 must NEVER sync into this conversation.
  perform public.test_assert(not exists (
    select 1 from public.steward_scope_items
     where task_id in ('10000000-0000-0000-0000-000000000007',
                       '10000000-0000-0000-0000-000000000008')),
    'legacy and other-meeting correlation keys never sync');
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
  -- 5 remaining scope items (tasks 5, 1, 2, 3, synced a) + 2 countable
  -- commitments (commit-a open, commit-b done; ext-3948 is linked to
  -- in-scope task 1 so it is not double counted; cancelled excluded).
  perform public.test_assert(c.denominator = 7, 'amended item leaves the denominator; commitments and synced task remain');
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

-- 9. Adversarial: foreign conversation, malformed correlation keys,
--    cross-meeting dedup, and amendment operation replay/conflict.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- org A owner

-- 9a. A task cannot be scoped into ANOTHER org's conversation (FK alone
--     only proves existence).
select public.test_denied($q$
  select public.steward_scope_add_item(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd01',
    '10000000-0000-0000-0000-000000000002', 'manual_required', gen_random_uuid()) $q$,
  'foreign conversation rejected by add_item');

-- 9b. Malformed correlation keys never sync: wrong part count, non-UUID
--     operation, prefix lookalikes.
insert into public.steward_tasks
  (id, organization_id, title, notes, correlation_id, task_visibility, owner_user_id, created_by, status) values
  ('10000000-0000-0000-0000-0000000000b1', '11111111-1111-1111-1111-111111111111', 'bad key 1', null,
   'cmd-meeting-required:v1:dddddddd-dddd-dddd-dddd-dddddddddddd', 'business', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open'),
  ('10000000-0000-0000-0000-0000000000b2', '11111111-1111-1111-1111-111111111111', 'bad key 2', null,
   'cmd-meeting-required:v1:dddddddd-dddd-dddd-dddd-dddddddddddd:not-a-uuid', 'business', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open'),
  ('10000000-0000-0000-0000-0000000000b3', '11111111-1111-1111-1111-111111111111', 'bad key 3', null,
   'cmd-meeting-required:v2:dddddddd-dddd-dddd-dddd-dddddddddddd:eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'business', null, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open');
do $$
declare n integer;
begin
  n := public.steward_scope_sync_required(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'f0000000-0000-0000-0000-0000000000b9');
  perform public.test_assert(n = 0, 'malformed correlation keys never sync');
end $$;

-- 9c. Cross-meeting dedup: scoping the SAME linked task into ANOTHER
--     meeting must not suppress THIS meeting's confirmed-commitment
--     denominator (the exclusion is per-conversation, not global).
insert into public.conversations (id, organization_id, title, transcript) values
  ('dddddddd-dddd-dddd-dddd-dddddddddd02', '11111111-1111-1111-1111-111111111111',
   'Second org A call',
   '{"segments":[{"speaker":"Tai","text":"Second synthetic call.","offset":0}]}'::jsonb);
do $$
declare before_count integer; after_count integer; c record;
begin
  select denominator into before_count from public.steward_scope_counts(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.steward_scope_add_item(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd02',
    (select lk.task_id from public.steward_proposal_links lk
      join public.steward_proposal_ledger pl on pl.id = lk.proposal_ledger_id
      where pl.organization_id = '11111111-1111-1111-1111-111111111111'
        and pl.source_key = 'ext-3948' limit 1),
    'manual_required', 'f0000000-0000-0000-0000-0000000000c1');
  select denominator into after_count from public.steward_scope_counts(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(after_count = before_count,
    'cross-meeting scoping does not suppress this meeting commitment denominator');
  select * into c from public.steward_scope_counts(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd02');
  perform public.test_assert(c.denominator = 1,
    'second meeting counts its own scope item');
end $$;

-- 9d. Amendment operation replay: same operation + same payload replays
--     the already-amended item; same operation + changed payload
--     conflicts — a retried removal can never error as 'already_removed'
--     or silently double-apply.
do $$
declare
  target uuid;
  first_item public.steward_scope_items;
  replayed public.steward_scope_items;
  conflicted boolean := false;
begin
  select id into target from public.steward_scope_items
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'
     and removed_at is null limit 1;
  first_item := public.steward_scope_amend_remove(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    target, 'scope correction: recorded in error', 'f0000000-0000-0000-0000-0000000000d1');
  replayed := public.steward_scope_amend_remove(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    target, 'scope correction: recorded in error', 'f0000000-0000-0000-0000-0000000000d1');
  perform public.test_assert(replayed.id = first_item.id and replayed.removed_at is not null,
    'same amendment operation replays');
  begin
    perform public.steward_scope_amend_remove(
      '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
      target, 'a DIFFERENT reason for the same operation', 'f0000000-0000-0000-0000-0000000000d1');
  exception when sqlstate 'P0002' then conflicted := true;
  end;
  perform public.test_assert(conflicted, 'changed payload on same amendment operation conflicts');
end $$;
reset role;
