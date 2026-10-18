-- Data-preserving operational rollback for 005_scope_membership (final
-- step). Drops the remaining functions and shared helpers ONLY. All
-- tables, rows, RLS, select policies and immutability triggers are KEPT:
-- retained history remains org-scoped, business-only and immutable, and
-- any SELECT grants from grants.review.sql remain gated by the policies.
drop function if exists public.steward_scope_add_item(uuid, uuid, uuid, text, uuid);
drop function if exists public.steward_scope_sync_required(uuid, uuid, uuid);
drop function if exists public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid);
drop function if exists public.steward_scope_counts(uuid, uuid);
drop function if exists private.steward_invalidate_scope(uuid, uuid);
drop function if exists private.steward_is_active_member(uuid);
drop function if exists private.steward_can_write(uuid);
drop function if exists private.steward_is_admin(uuid);
drop function if exists private.steward_user_can_write(uuid, uuid);
drop function if exists private.steward_user_is_admin(uuid, uuid);
drop function if exists private.steward_user_has_task_authority(public.steward_tasks, uuid);
