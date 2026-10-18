-- Data-preserving operational rollback for 001_canonical_runs.
-- Removes the functions ONLY. The table, every row, RLS and the select
-- policy are KEPT: retained history stays protected by exactly the same
-- membership + business-visibility rules as before rollback, and any
-- SELECT grants from grants.review.sql remain harmless because the policy
-- still gates every read. RLS is NEVER disabled here.
drop function if exists public.steward_fail_canonical_run(uuid, uuid, text);
drop function if exists public.steward_complete_canonical_run(uuid, uuid, text, jsonb);
drop function if exists public.steward_claim_canonical_run(uuid, integer);
drop function if exists public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb);
drop function if exists public.steward_resolve_input(uuid, text, uuid);
drop function if exists private.steward_revalidate_requester(public.steward_canonical_runs);
-- The added steward_tasks columns are additive and harmless; they are kept
-- so retained rows remain intact. Membership helpers are shared by
-- 002-005; drop them only in the final rollback step (005 down).
