-- Canonical runs: identity, authority, snapshot immutability, fencing.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- org A owner

-- 1. Request resolves and snapshots input content server-side.
do $$
declare r public.steward_canonical_runs;
begin
  r := public.steward_request_canonical_run(
    '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    'prepare_handoff', 'a0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb);
  perform public.test_assert(r.status = 'queued' and r.attempts = 0, 'new run starts queued');
  perform public.test_assert(r.requested_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'requester derived from auth.uid');
  perform public.test_assert(r.input_snapshot->0->>'content' = 'Ordered synthetic transcript text for the Soji call.',
    'snapshot persists resolved content');
  perform public.test_assert(char_length(r.input_snapshot->0->>'content_digest') = 64, 'snapshot carries content digest');
end $$;

-- 2. Same operation + same payload replays; changed payload conflicts.
do $$
declare r public.steward_canonical_runs; conflicted boolean := false;
begin
  r := public.steward_request_canonical_run(
    '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    'prepare_handoff', 'a0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb);
  perform public.test_assert(r.status = 'queued', 'same operation replays');
  begin
    perform public.steward_request_canonical_run(
      '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
      'prepare_handoff', 'a0000000-0000-0000-0000-000000000001',
      '[{"kind":"task_notes","id":"10000000-0000-0000-0000-000000000001"}]'::jsonb);
  exception when raise_exception then conflicted := true; end;
  perform public.test_assert(conflicted, 'same operation with changed payload conflicts');
end $$;

-- 3. Empty inputs and unknown actions rejected.
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'prepare_handoff',
    'a0000000-0000-0000-0000-000000000002', '[]'::jsonb) $q$, 'empty inputs rejected');
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'build_website',
    'a0000000-0000-0000-0000-000000000002',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb) $q$, 'action allowlist enforced');

-- 4. Inaccessible inputs rejected: cross-org conversation, personal task of
--    another user, nonexistent ref.
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'prepare_handoff',
    'a0000000-0000-0000-0000-000000000003',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddd01"}]'::jsonb) $q$, 'cross-org transcript rejected');
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); -- member
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000002', 'prepare_brief',
    'b0000000-0000-0000-0000-000000000001',
    '[{"kind":"task_notes","id":"10000000-0000-0000-0000-000000000004"}]'::jsonb) $q$, 'personal notes of another user rejected');

-- 5. Authority: member cannot request a run on the owner's task; viewer and
--    inactive members cannot request at all; cross-org user gets nothing.
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'prepare_brief',
    'b0000000-0000-0000-0000-000000000002',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb) $q$, 'member without task authority rejected');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001'); -- viewer
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'prepare_brief',
    'd0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb) $q$, 'viewer rejected');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001'); -- inactive
select public.test_denied($q$
  select public.steward_request_canonical_run('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 'prepare_brief',
    'e0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb) $q$, 'inactive member rejected');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc'); -- cross-org
select public.test_denied($q$
  select public.steward_request_canonical_run('22222222-2222-2222-2222-222222222222',
    '10000000-0000-0000-0000-000000000001', 'prepare_brief',
    'c0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddd01"}]'::jsonb) $q$, 'cross-org task invisible');

-- 6. Fencing: claim, lease expiry, reclaim, stale token cannot complete.
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
declare
  rid uuid; r public.steward_canonical_runs; stale uuid; fresh uuid;
begin
  r := public.steward_request_canonical_run(
    '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    'prepare_brief', 'a0000000-0000-0000-0000-000000000004',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb);
  rid := r.id;
  r := public.steward_claim_canonical_run(rid, 0); -- immediately expired lease
  perform public.test_assert(r.status = 'running' and r.attempts = 1 and r.claim_token is not null, 'first claim issues fencing token');
  stale := r.claim_token;
  r := public.steward_claim_canonical_run(rid);
  perform public.test_assert(r.status = 'running' and r.attempts = 2 and r.claim_token is distinct from stale,
    'expired lease reclaimable with fresh token');
  fresh := r.claim_token;
  begin
    perform public.steward_complete_canonical_run(rid, stale, 'stale worker artifact');
    raise exception 'FAILED: stale token completed';
  exception when raise_exception then
    if sqlerrm like 'FAILED%' then raise; end if;
  end;
  perform public.test_assert(true, 'stale fencing token cannot complete');
  r := public.steward_complete_canonical_run(rid, fresh, 'current worker artifact');
  perform public.test_assert(r.status = 'complete'
    and r.artifact_digest = encode(sha256(convert_to('current worker artifact','utf8')), 'hex'),
    'current token completes with digest');
end $$;

-- 7. Snapshot isolation: editing the source after the request does not
--    change what the run recorded.
do $$
declare r public.steward_canonical_runs;
begin
  update public.steward_conversations set transcript_text = 'EDITED after request'
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  select * into r from public.steward_canonical_runs
   where client_operation_id = 'a0000000-0000-0000-0000-000000000001';
  perform public.test_assert(r.input_snapshot->0->>'content' = 'Ordered synthetic transcript text for the Soji call.',
    'snapshot immune to later source edits');
  update public.steward_conversations set transcript_text = 'Ordered synthetic transcript text for the Soji call.'
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
end $$;

-- 8. Attempt exhaustion fails terminally; exhausted run cannot be claimed.
do $$
declare rid uuid; r public.steward_canonical_runs;
begin
  r := public.steward_request_canonical_run(
    '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    'prepare_brief', 'a0000000-0000-0000-0000-000000000005',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"}]'::jsonb);
  rid := r.id;
  for i in 1..3 loop
    r := public.steward_claim_canonical_run(rid);
    r := public.steward_fail_canonical_run(rid, r.claim_token, 'synthetic provider failure');
  end loop;
  perform public.test_assert(r.status = 'failed', 'attempts exhaust to failed');
  r := public.steward_claim_canonical_run(rid);
  perform public.test_assert(r.id is null, 'exhausted run cannot be claimed');
end $$;

-- 9. Direct table writes are denied to authenticated (SELECT-only grant +
--    no write policies): clients cannot forge runs or artifacts.
select public.test_denied($q$
  insert into public.steward_canonical_runs
    (organization_id, task_id, action, client_operation_id, request_digest, input_snapshot, requested_by)
  values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    'prepare_brief', gen_random_uuid(), 'forged', '[]', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct run insert denied');
select public.test_denied($q$
  update public.steward_canonical_runs set status = 'complete', artifact_text = 'forged'
   where client_operation_id = 'a0000000-0000-0000-0000-000000000001' $q$,
  'direct run update denied');

-- 10. Members can read org runs; cross-org users cannot.
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
do $$
declare n integer;
begin
  select count(*) into n from public.steward_canonical_runs
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n > 0, 'org member reads runs');
end $$;
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
do $$
declare n integer;
begin
  select count(*) into n from public.steward_canonical_runs
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n = 0, 'cross-org read denied by RLS');
end $$;
reset role;
