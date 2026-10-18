-- Canonical run request/claim/complete/fail semantics. Each DO block aborts
-- the script (nonzero exit) on failure.

-- 1. Owner can request; replay with same digest returns the same row.
do $$
declare r1 steward_canonical_runs; r2 steward_canonical_runs;
begin
  r1 := steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'prepare_brief',
        'a0000000-0000-0000-0000-000000000001', 'digest-1', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  r2 := steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'prepare_brief',
        'a0000000-0000-0000-0000-000000000001', 'digest-1', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert r1.id = r2.id, 'same operation must replay the same run';
  assert r1.status = 'queued', 'new run starts queued';
end $$;

-- 2. Same operation UUID with a changed payload conflicts.
do $$
begin
  perform steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'draft_roadmap',
        'a0000000-0000-0000-0000-000000000001', 'digest-CHANGED', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'expected operation_conflict';
exception when sqlstate 'P0002' then null;
end $$;

-- 3. New operation UUID = intentional rerun = a new row.
do $$
declare r3 steward_canonical_runs; n integer;
begin
  r3 := steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'prepare_brief',
        'a0000000-0000-0000-0000-000000000002', 'digest-1', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  select count(*) into n from steward_canonical_runs where task_id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert n = 2, 'deliberate rerun must create a new run row';
end $$;

-- 4. Non-owner/non-creator cannot request; cross-org task is inaccessible.
do $$
begin
  perform steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'prepare_brief',
        'a0000000-0000-0000-0000-000000000003', 'd', '[]'::jsonb, 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
  raise exception 'expected not_authorized';
exception when sqlstate 'P0004' then null;
end $$;
do $$
begin
  perform steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000003', 'prepare_brief',
        'a0000000-0000-0000-0000-000000000004', 'd', '[]'::jsonb, 'cccccccc-cccc-cccc-cccc-cccccccccccc');
  raise exception 'expected task_not_found_or_inaccessible';
exception when sqlstate 'P0003' then null;
end $$;

-- 5. Claim by the requester; a second claim while leased returns null.
do $$
declare r steward_canonical_runs; again steward_canonical_runs;
begin
  r := steward_claim_canonical_run(
        (select id from steward_canonical_runs
          where client_operation_id = 'a0000000-0000-0000-0000-000000000001'), 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert r.status = 'running' and r.attempts = 1, 'claim must start the run once';
  again := steward_claim_canonical_run(r.id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert again is null, 'a leased run cannot be claimed twice';
end $$;

-- 6. Complete writes artifact+digest only; the task row is untouched.
do $$
declare r steward_canonical_runs; t steward_tasks;
begin
  r := steward_complete_canonical_run(
        (select id from steward_canonical_runs
          where client_operation_id = 'a0000000-0000-0000-0000-000000000001'),
        'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'draft brief text', 'sha256-x', '["task:notes"]'::jsonb);
  assert r.status = 'complete' and r.artifact_digest = 'sha256-x';
  select * into t from steward_tasks where id = '10000000-0000-0000-0000-000000000001'::uuid;
  assert t.status = 'open' and t.revision = 1 and t.completion_evidence is null,
    'a preparation run must never mutate the task';
end $$;

-- 7. Provider failure: fail returns to queued while attempts remain, then
--    terminally fails when exhausted — no stranded running run.
do $$
declare rid uuid; r steward_canonical_runs;
begin
  select id into rid from steward_canonical_runs
   where client_operation_id = 'a0000000-0000-0000-0000-000000000002';
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  r := steward_fail_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'provider timeout');
  assert r.status = 'queued', 'failure with attempts left requeues';
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  r := steward_fail_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'provider timeout');
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  r := steward_fail_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'provider timeout');
  assert r.status = 'failed' and r.attempts = 3, 'exhausted attempts fail terminally';
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert r is null, 'a failed run cannot be claimed again';
end $$;

-- 8. Expired lease is recoverable by a later claim.
do $$
declare rid uuid; r steward_canonical_runs;
begin
  select (steward_request_canonical_run('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001', 'prepare_handoff',
        'a0000000-0000-0000-0000-000000000005', 'd', '[]'::jsonb, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')).id into rid;
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 0); -- immediately expired lease
  assert r.status = 'running';
  r := steward_claim_canonical_run(rid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert r.id is not null and r.attempts = 2, 'expired lease must be reclaimable';
end $$;
