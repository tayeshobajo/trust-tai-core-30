-- Proposal links: canonical ledger identity, existence validation,
-- idempotency, scope invalidation. The ledger mirrors the real extraction
-- contract (source_key, like commitments.source_key); extraction writes
-- are service-side, so the fixture seeds it as service_role.
set role service_role;
select public.test_act_as_worker();
insert into public.steward_proposal_ledger
  (id, organization_id, conversation_id, source_key, kind, statement) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ext-3948', 'action', 'Roadmap proposal at 39:48'),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ext-5357', 'action', 'Mockup proposal at 53:57'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee001', '22222222-2222-2222-2222-222222222222',
   'dddddddd-dddd-dddd-dddd-dddddddddd01', 'ext-b1', 'action', 'Org B proposal');
reset role;

-- 0. Baseline: attest coverage so the link's invalidation is observable.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
do $$
begin
  perform public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'coverage valid before link');
end $$;

-- 1. Link happy path: explicit human decision, no task/commitment created,
--    ledger status flips to linked, coverage invalidated in-transaction.
do $$
declare l public.steward_proposal_links; n integer; v integer; s text;
begin
  select count(*) into n from public.steward_tasks
   where organization_id = '11111111-1111-1111-1111-111111111111';
  l := public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
  perform public.test_assert(l.actor_id = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'link actor from auth.uid');
  perform public.test_assert((select count(*) from public.steward_tasks
    where organization_id = '11111111-1111-1111-1111-111111111111') = n, 'linking never creates a task');
  select status into s from public.steward_proposal_ledger where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  perform public.test_assert(s = 'linked', 'ledger proposal marked linked');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'link supersedes coverage');
  select version into v from public.steward_scope_versions
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(v >= 3, 'link durably bumps scope version');
end $$;

-- 2. Same operation replays; different operation on linked proposal
--    conflicts; reused UUID with changed payload conflicts.
do $$
declare l public.steward_proposal_links;
begin
  l := public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001');
  perform public.test_assert(l.id is not null, 'same operation replays link');
end $$;
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    '10000000-0000-0000-0000-000000000002', 'c1000000-0000-0000-0000-000000000002') $q$,
  'second link of same proposal conflicts');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000001') $q$,
  'reused operation UUID with changed payload conflicts');

-- 3. Existence: proposal from another conversation/org and unknown task
--    rejected; personal tasks out of scope.
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'eeeeeeee-eeee-eeee-eeee-eeeeeeeee001',
    '10000000-0000-0000-0000-000000000001', 'c1000000-0000-0000-0000-000000000003') $q$,
  'cross-org proposal rejected');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000099', 'c1000000-0000-0000-0000-000000000004') $q$,
  'unknown task rejected');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000004', 'c1000000-0000-0000-0000-000000000005') $q$,
  'personal task link rejected');

-- 4. Authority: member cannot link to the owner's task; viewer/inactive
--    cannot link at all.
select public.test_act_as('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000001') $q$,
  'member cannot link to another user task');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000002') $q$,
  'viewer cannot link');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_link_proposal('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'ffffffff-ffff-ffff-ffff-ffffffffffff',
    '10000000-0000-0000-0000-000000000001', 'c2000000-0000-0000-0000-000000000003') $q$,
  'inactive cannot link');

-- 5. Links are immutable; direct writes denied.
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  insert into public.steward_proposal_links
    (organization_id, conversation_id, proposal_ledger_id, task_id, operation_id, request_digest, actor_id)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'ffffffff-ffff-ffff-ffff-ffffffffffff', '10000000-0000-0000-0000-000000000001',
    gen_random_uuid(), 'forged', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct link insert denied');
reset role;
select public.test_denied($q$
  delete from public.steward_proposal_links where true $q$, 'link delete blocked by trigger');
