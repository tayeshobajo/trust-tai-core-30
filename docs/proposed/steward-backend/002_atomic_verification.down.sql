-- Data-preserving operational rollback for 002_atomic_verification.
-- Keeps receipts and audit rows intact.
drop function if exists public.steward_reopen_task(uuid, uuid, integer, uuid, text);
drop function if exists public.steward_verify_task(uuid, uuid, integer, uuid, text);
drop trigger if exists steward_receipts_immutable on public.steward_task_receipts;
drop trigger if exists steward_audit_immutable on public.steward_task_audit;
drop policy if exists steward_task_receipts_select on public.steward_task_receipts;
drop policy if exists steward_task_audit_select on public.steward_task_audit;
alter table public.steward_task_receipts disable row level security;
alter table public.steward_task_audit disable row level security;
-- steward_block_history_mutation is shared by 003/004/005 triggers; dropped
-- in the final rollback step.
