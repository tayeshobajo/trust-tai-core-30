-- Data-preserving operational rollback for 001_canonical_runs.
-- Removes functions and policies and disables RLS, but KEEPS the table and
-- every row. Destructive teardown lives in teardown.destructive.sql and is
-- guarded against non-empty data.
drop function if exists public.steward_fail_canonical_run(uuid, uuid, text);
drop function if exists public.steward_complete_canonical_run(uuid, uuid, text, jsonb);
drop function if exists public.steward_claim_canonical_run(uuid, integer);
drop function if exists public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb);
drop function if exists public.steward_resolve_input(uuid, text, uuid);
drop policy if exists steward_canonical_runs_select on public.steward_canonical_runs;
alter table public.steward_canonical_runs disable row level security;
-- Membership helpers are shared by 002-005; drop them only in the final
-- rollback step (005_canonical down / teardown).
