-- DESTRUCTIVE teardown — REVIEW ONLY. Drops the proposed tables AND their
-- history. Refuses to run while any table holds rows; empty the tables
-- through a reviewed operational procedure first. Normal rollback is the
-- data-preserving 00x.down.sql series — use that instead.
-- The guard and the drops live in ONE block: if the guard refuses, nothing
-- is dropped, regardless of how the script is executed.
do $$
declare
  n bigint;
  t text;
begin
  select (select count(*) from public.steward_canonical_runs)
       + (select count(*) from public.steward_task_receipts)
       + (select count(*) from public.steward_task_audit)
       + (select count(*) from public.steward_coverage_attestations)
       + (select count(*) from public.steward_scope_versions)
       + (select count(*) from public.steward_proposal_links)
       + (select count(*) from public.steward_scope_items)
       + (select count(*) from public.steward_scope_audit)
       + (select count(*) from public.steward_proposal_ledger)
       + (select count(*) from public.steward_proposal_decisions)
    into n;
  if n > 0 then
    raise exception 'teardown_refused: % rows of history remain; use the data-preserving down patches', n
      using errcode = 'P0405';
  end if;
  foreach t in array array[
    'steward_proposal_decisions', 'steward_proposal_ledger',
    'steward_scope_audit', 'steward_scope_items', 'steward_proposal_links',
    'steward_coverage_attestations', 'steward_scope_versions',
    'steward_task_audit', 'steward_task_receipts', 'steward_canonical_runs']
  loop
    execute format('drop table if exists public.%I', t);
  end loop;
end;
$$;
