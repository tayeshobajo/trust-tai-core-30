-- Proposal-to-existing-task linking: explicit, idempotent, never duplicating.
\set task_2 '''10000000-0000-0000-0000-000000000002'''
\set task_b '''10000000-0000-0000-0000-000000000003'''

-- 1. Link proposal to an existing task; coverage for the conversation is
--    superseded by the scope decision.
do $$
declare l steward_proposal_links;
begin
  perform steward_attest_coverage(:org_a, :conv_1, 'hash-link', 1, :user_owner);
  l := steward_link_proposal(:org_a, :conv_1, :prop_1, :task_2,
        'c0000000-0000-0000-0000-000000000001', :user_owner);
  assert l.task_id = :task_2::uuid;
  assert not steward_current_coverage(:org_a, :conv_1, 'hash-link', 1),
    'a link decision must invalidate coverage';
end $$;

-- 2. Replaying the same operation returns the same link; no new row.
do $$
declare l steward_proposal_links; n integer;
begin
  l := steward_link_proposal(:org_a, :conv_1, :prop_1, :task_2,
        'c0000000-0000-0000-0000-000000000001', :user_owner);
  select count(*) into n from steward_proposal_links where proposal_id = :prop_1::uuid;
  assert n = 1, 'replay must not duplicate the link';
end $$;

-- 3. A different operation for an already-linked proposal conflicts.
do $$
begin
  perform steward_link_proposal(:org_a, :conv_1, :prop_1, :task_2,
        'c0000000-0000-0000-0000-000000000002', :user_owner);
  raise exception 'expected proposal_already_linked';
exception when sqlstate 'P0030' then null;
end $$;

-- 4. Linking to a task in another org is inaccessible; nothing is created.
do $$
declare n integer;
begin
  perform steward_link_proposal(:org_a, :conv_1, :prop_2, :task_b,
        'c0000000-0000-0000-0000-000000000003', :user_owner);
  raise exception 'expected task_not_found_or_inaccessible';
exception when sqlstate 'P0003' then
  select count(*) into n from steward_tasks;
  assert n = 4, 'linking must never create a task';
end $$;
