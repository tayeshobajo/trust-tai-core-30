-- DESTRUCTIVE teardown — REVIEW ONLY. Drops the proposed tables AND their
-- history. Refuses to run while any table holds rows; empty the tables
-- through a reviewed operational procedure first. Normal rollback is the
-- data-preserving 00x.down.sql series — use that instead.
do $$
declare
  n bigint;
begin
  select (select count(*) from public.steward_canonical_runs)
       + (select count(*) from public.steward_task_receipts)
       + (select count(*) from public.steward_task_audit)
       + (select count(*) from public.steward_coverage_attestations)
       + (select count(*) from public.steward_scope_versions)
       + (select count(*) from public.steward_proposal_links)
       + (select count(*) from public.steward_scope_items)
       + (select count(*) from public.steward_scope_audit)
    into n;
  if n > 0 then
    raise exception 'teardown_refused: % rows of history remain; use the data-preserving down patches', n
      using errcode = 'P0405';
  end if;
end;
$$;

drop table if exists public.steward_scope_audit;
drop table if exists public.steward_scope_items;
drop table if exists public.steward_proposal_links;
drop table if exists public.steward_coverage_attestations;
drop table if exists public.steward_scope_versions;
drop table if exists public.steward_task_audit;
drop table if exists public.steward_task_receipts;
drop table if exists public.steward_canonical_runs;
