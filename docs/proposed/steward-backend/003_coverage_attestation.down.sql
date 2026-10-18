-- Data-preserving operational rollback for 003_coverage_attestation.
-- Drops the attestation functions ONLY. Attestations, scope versions, RLS,
-- select policies and the immutability trigger are KEPT, so retained
-- history stays org-scoped and tamper-proof after rollback.
drop function if exists public.steward_attest_coverage(uuid, uuid, uuid, text, integer);
drop function if exists public.steward_attest_coverage(uuid, uuid);
drop function if exists public.steward_current_coverage(uuid, uuid);
drop function if exists private.steward_transcript_hash(uuid, uuid);
-- private.steward_invalidate_scope is shared by 004/005; dropped in the
-- final rollback step. steward_guard_coverage_mutation is dropped in 005
-- down after the dependent triggers are removed.
