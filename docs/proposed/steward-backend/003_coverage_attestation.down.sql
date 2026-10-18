-- Data-preserving operational rollback for 003_coverage_attestation.
drop function if exists public.steward_current_coverage(uuid, uuid);
drop function if exists public.steward_attest_coverage(uuid, uuid);
drop trigger if exists steward_coverage_immutable on public.steward_coverage_attestations;
drop function if exists public.steward_guard_coverage_mutation();
drop policy if exists steward_coverage_attestations_select on public.steward_coverage_attestations;
drop policy if exists steward_scope_versions_select on public.steward_scope_versions;
alter table public.steward_coverage_attestations disable row level security;
alter table public.steward_scope_versions disable row level security;
