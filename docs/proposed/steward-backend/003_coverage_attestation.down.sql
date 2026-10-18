-- Rollback for 003_coverage_attestation.up.sql (PROPOSED, UNAPPLIED).
drop function if exists steward_current_coverage(uuid,uuid,text,integer);
drop function if exists steward_attest_coverage(uuid,uuid,text,integer,uuid);
drop table if exists steward_coverage_attestations;
