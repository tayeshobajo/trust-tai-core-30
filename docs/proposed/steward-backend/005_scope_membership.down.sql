-- Data-preserving operational rollback for 005_scope_membership.
-- Also drops the shared helpers (001) and shared immutability trigger
-- function (002) — this is the final rollback step.
drop function if exists public.steward_scope_counts(uuid, uuid);
drop function if exists public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid);
drop function if exists public.steward_scope_add_item(uuid, uuid, uuid, text, uuid);
drop trigger if exists steward_scope_items_no_delete on public.steward_scope_items;
drop trigger if exists steward_scope_items_guard_update on public.steward_scope_items;
drop trigger if exists steward_scope_audit_immutable on public.steward_scope_audit;
drop function if exists public.steward_guard_scope_update();
drop function if exists public.steward_block_scope_delete();
drop policy if exists steward_scope_items_select on public.steward_scope_items;
drop policy if exists steward_scope_audit_select on public.steward_scope_audit;
alter table public.steward_scope_items disable row level security;
alter table public.steward_scope_audit disable row level security;
-- Shared helpers from 001/002:
drop function if exists public.steward_block_history_mutation();
drop function if exists private.steward_is_admin(uuid);
drop function if exists private.steward_can_write(uuid);
drop function if exists private.steward_is_active_member(uuid);
