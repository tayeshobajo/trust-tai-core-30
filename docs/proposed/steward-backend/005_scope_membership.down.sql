-- Data-preserving operational rollback for 005_scope_membership (final
-- step). Drops the remaining public functions ONLY. All tables, rows, RLS,
-- select policies and immutability triggers are KEPT: retained history
-- remains org-scoped, business-only and immutable, and any SELECT grants
-- from grants.review.sql remain gated by the policies.
-- The private membership helpers and the immutability trigger functions
-- are KEPT because the retained policies and triggers still reference
-- them; they are dropped only by teardown.destructive.sql after the
-- guarded empty-data check removes the tables, policies and triggers.
drop function if exists public.steward_scope_add_item(uuid, uuid, uuid, text, uuid);
drop function if exists public.steward_scope_sync_required(uuid, uuid, uuid);
drop function if exists public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid);
drop function if exists public.steward_scope_counts(uuid, uuid);
drop function if exists private.steward_invalidate_scope(uuid, uuid);
