-- Rollback for 002_atomic_verification.up.sql (PROPOSED, UNAPPLIED).
drop function if exists steward_reopen_task(uuid,uuid,integer,uuid,text,uuid);
drop function if exists steward_verify_task(uuid,uuid,integer,uuid,text,uuid);
drop table if exists steward_task_audit;
drop table if exists steward_task_receipts;
