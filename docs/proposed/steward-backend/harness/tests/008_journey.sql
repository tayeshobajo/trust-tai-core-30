-- Full fixture journey through the REAL SQL surface: request → worker
-- claim → complete (artifact) → human verify → reopen → re-verify →
-- coverage attest → scope counts. Proves the stages compose with the same
-- contracts the TS adapters call.
reset role;
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. Request a preparation run on the member-owned task (owner has admin
--    authority) with transcript + notes inputs.
do $$
declare j jsonb; r public.steward_canonical_runs;
begin
  j := public.steward_request_canonical_run(
    '11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000002',
    'prepare_brief', 'e0000000-0000-0000-0000-000000000001',
    '[{"kind":"transcript","id":"dddddddd-dddd-dddd-dddd-dddddddddddd"},
      {"kind":"task_notes","id":"10000000-0000-0000-0000-000000000002"}]'::jsonb);
  r := jsonb_populate_record(null::public.steward_canonical_runs, j->'run');
  perform public.test_assert(r.status = 'queued' and jsonb_array_length(r.input_snapshot) = 2,
    'journey: run queued with two snapshotted inputs');
end $$;

-- 2. Worker claims and completes with an artifact; the run never touches
--    task status.
select public.test_act_as_worker();
set role service_role;
do $$
declare rid uuid; r public.steward_canonical_runs; t public.steward_tasks;
begin
  select id into rid from public.steward_canonical_runs
   where client_operation_id = 'e0000000-0000-0000-0000-000000000001';
  r := public.steward_claim_canonical_run(rid);
  perform public.test_assert(r.status = 'running' and r.claim_token is not null, 'journey: worker claimed');
  r := public.steward_complete_canonical_run(rid, r.claim_token,
    'Draft brief: synthetic artifact from the fake provider.');
  perform public.test_assert(r.status = 'complete' and r.artifact_digest is not null, 'journey: artifact stored with digest');
  select * into t from public.steward_tasks where id = '10000000-0000-0000-0000-000000000002';
  perform public.test_assert(t.status = 'complete' and t.revision = 1,
    'journey: run completion never touches task status or verification');
end $$;

-- 3. Human verifies with evidence (revision-bound), then reopens; credit
--    appears and disappears honestly in scope counts.
reset role;
set role authenticated;
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'); -- task owner
do $$
declare c record;
begin
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'e1000000-0000-0000-0000-000000000001');
exception when sqlstate 'P0030' then null; -- already in scope from 005
end $$;
do $$
declare res jsonb; c record; rev integer;
begin
  select revision into rev from public.steward_tasks where id = '10000000-0000-0000-0000-000000000002';
  res := public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000002', rev, 'e2000000-0000-0000-0000-000000000001',
    'Journey verification against the recorded artifact.');
  perform public.test_assert((res->>'replayed')::boolean = false, 'journey: fresh verify not replayed');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.verified = 1, 'journey: verify earns revision-bound credit');
  res := public.steward_reopen_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000002', rev + 1, 'e2000000-0000-0000-0000-000000000002',
    'Journey reopen: artifact needs human polish.');
  perform public.test_assert((res->>'replayed')::boolean = false, 'journey: fresh reopen not replayed');
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.verified = 0, 'journey: reopen drops the credit');
end $$;

-- 4. Legacy status flip after reopen cannot regain credit.
reset role;
update public.steward_tasks set status = 'complete'
 where id = '10000000-0000-0000-0000-000000000002';
reset role;
set role authenticated;
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
do $$
declare c record;
begin
  select * into c from public.steward_scope_counts('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(c.verified = 0, 'journey: legacy status flip after reopen earns nothing');
end $$;
reset role;
update public.steward_tasks set status = 'open'
 where id = '10000000-0000-0000-0000-000000000002';

-- 5. Coverage attestation over the real conversation composes with scope.
reset role;
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
begin
  perform public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c8000000-0000-0000-0000-000000000000',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    coalesce((select version from public.steward_scope_versions
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 1));
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'journey: coverage attested at final state');
end $$;
reset role;
