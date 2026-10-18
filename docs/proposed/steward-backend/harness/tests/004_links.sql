-- Proposal-to-existing-task linking: explicit, idempotent, never duplicating.

-- 1. Link proposal to an existing task; coverage for the conversation is
--    superseded by the scope decision.
do $$
declare l steward_proposal_links;
begin
  perform steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'hash-link-0123456789ab', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  l := steward_link_proposal('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '10000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert l.task_id = '10000000-0000-0000-0000-000000000002'::uuid;
  assert not steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'hash-link-0123456789ab', 1),
    'a link decision must invalidate coverage';
end $$;

-- 2. Replaying the same operation returns the same link; no new row.
do $$
declare l steward_proposal_links; n integer;
begin
  l := steward_link_proposal('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '10000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000001', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  select count(*) into n from steward_proposal_links where proposal_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee'::uuid;
  assert n = 1, 'replay must not duplicate the link';
end $$;

-- 3. A different operation for an already-linked proposal conflicts.
do $$
begin
  perform steward_link_proposal('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '10000000-0000-0000-0000-000000000002',
        'c0000000-0000-0000-0000-000000000002', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'expected proposal_already_linked';
exception when sqlstate 'P0030' then null;
end $$;

-- 4. Linking to a task in another org is inaccessible; nothing is created.
do $$
declare n integer;
begin
  perform steward_link_proposal('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff', '10000000-0000-0000-0000-000000000003',
        'c0000000-0000-0000-0000-000000000003', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'expected task_not_found_or_inaccessible';
exception when sqlstate 'P0003' then
  select count(*) into n from steward_tasks;
  assert n = 4, 'linking must never create a task';
end $$;
