-- Data-preserving operational rollback for 002_atomic_verification.
-- Drops the verify/reopen functions ONLY. Receipts, audit rows, RLS,
-- select policies and the append-only triggers are KEPT, so retained
-- history stays org-scoped, business-only and immutable after rollback.
drop function if exists public.steward_verify_task(uuid, uuid, integer, uuid, text);
drop function if exists public.steward_reopen_task(uuid, uuid, integer, uuid, text);
-- steward_block_history_mutation is shared by 004/005 triggers; dropped in
-- the final rollback step.
