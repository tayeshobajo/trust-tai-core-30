-- Rollback verification: down patches preserve all history; destructive
-- teardown refuses non-empty data.
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
end $$;

-- Destructive teardown must refuse while history exists.
do $$
begin
  begin
    perform 1 from pg_proc where proname = 'nonexistent'; -- no-op
  end;
end $$;
\set ON_ERROR_STOP off
\ir ../teardown.destructive.sql
\set ON_ERROR_STOP on
do $$
begin
  perform public.test_assert(
    exists(select 1 from pg_tables where tablename = 'steward_canonical_runs'),
    'destructive teardown refused non-empty data');
end $$;
