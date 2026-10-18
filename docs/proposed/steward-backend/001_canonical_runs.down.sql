-- Rollback for 001_canonical_runs.up.sql (PROPOSED, UNAPPLIED).
drop function if exists steward_fail_canonical_run(uuid,uuid,text);
drop function if exists steward_complete_canonical_run(uuid,uuid,text,text,jsonb);
drop function if exists steward_claim_canonical_run(uuid,uuid,integer);
drop function if exists steward_request_canonical_run(uuid,uuid,text,uuid,text,jsonb,uuid);
drop table if exists steward_canonical_runs;
