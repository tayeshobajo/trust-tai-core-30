-- Rollback verification: down patches preserve all history AND keep it
-- protected — RLS stays enabled, policies stay in place, immutability
-- triggers keep firing, and the removed functions are really gone.
do $$
declare n integer;
begin
  select (select count(*) from public.steward_canonical_runs)
       + (select count(*) from public.steward_task_receipts)
       + (select count(*) from public.steward_task_audit)
       + (select count(*) from public.steward_coverage_attestations)
       + (select count(*) from public.steward_proposal_links)
       + (select count(*) from public.steward_scope_items)
       + (select count(*) from public.steward_scope_audit)
    into n;
  perform public.test_assert(n > 0, 'down patches preserve all history rows');
  perform public.test_assert(
    (select relrowsecurity from pg_class where relname = 'steward_task_receipts'),
    'RLS still enabled on receipts after rollback');
  perform public.test_assert(
    (select relrowsecurity from pg_class where relname = 'steward_canonical_runs'),
    'RLS still enabled on runs after rollback');
  perform public.test_assert(
    exists(select 1 from pg_policies where tablename = 'steward_task_receipts'),
    'receipt select policy survives rollback');
end $$;

-- Functions are gone after rollback.
select public.test_denied($q$
  select public.steward_verify_task('11111111-1111-1111-1111-111111111111',
    '10000000-0000-0000-0000-000000000001', 0, gen_random_uuid(), 'post-rollback attempt') $q$,
  'verify function removed by rollback');

-- Retained history is still org-scoped: cross-org and inactive users read
-- nothing; direct writes are still denied; immutability triggers still
-- fire. (grants.review.sql SELECT grants remain in effect here, proving
-- the policies alone keep retained data safe.)
set role authenticated;
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc'); -- cross-org
do $$
declare n integer;
begin
  select count(*) into n from public.steward_task_receipts
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n = 0, 'cross-org read of retained receipts still denied after rollback');
  select count(*) into n from public.steward_canonical_runs
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n = 0, 'cross-org read of retained runs still denied after rollback');
end $$;
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001'); -- inactive
do $$
declare n integer;
begin
  select count(*) into n from public.steward_task_receipts
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n = 0, 'inactive member read of retained receipts still denied after rollback');
end $$;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'); -- owner
do $$
declare n integer;
begin
  select count(*) into n from public.steward_task_receipts
   where organization_id = '11111111-1111-1111-1111-111111111111';
  perform public.test_assert(n > 0, 'org member still reads retained receipts after rollback');
end $$;
select public.test_denied($q$
  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, task_revision_after, actor_id)
  values ('11111111-1111-1111-1111-111111111111', '10000000-0000-0000-0000-000000000001',
    gen_random_uuid(), 'verify', 'post-rollback forged receipt', 'forged', 1,
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct receipt insert still denied after rollback');
reset role;
select public.test_denied($q$
  delete from public.steward_task_receipts where true $q$,
  'immutability trigger still fires after rollback');

-- Destructive teardown must refuse while history exists.
\set ON_ERROR_STOP off
\ir ../../teardown.destructive.sql
\set ON_ERROR_STOP on
do $$
begin
  perform public.test_assert(
    exists(select 1 from pg_tables where tablename = 'steward_canonical_runs'),
    'destructive teardown refused non-empty data');
end $$;
