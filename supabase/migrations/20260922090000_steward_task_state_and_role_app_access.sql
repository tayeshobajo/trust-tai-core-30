-- Trust Tai OS. Apply two base tables that were authored in docs/ but never
-- migrated into production (okydosoacqdnursmmenf / trust-tai-os):
--
--   1. public.steward_task_state          (docs/steward-accountability-schema.sql)
--      Base-Steward task focus/ordering + meeting-only completion framing.
--      Without it the Steward Team page cannot persist focus or drag-reorder.
--
--   2. public.organization_role_app_access (docs/settings-schema.sql)
--      App-shell per-role room defaults. Fails closed, but 404s on every load.
--
-- Both 404 with PGRST205 on /modules/steward/dashboard. This migration is the
-- verbatim, idempotent DDL from those two docs files, plus the private.is_org_admin
-- helper that organization_role_app_access's write policy depends on.
--
-- Idempotent and additive: create ... if not exists, drop policy if exists,
-- create or replace function. Safe to run on a workspace that already has any
-- subset of these objects. Depends only on objects already present in prod:
-- public.organizations, public.organization_memberships, auth.users,
-- private.is_org_member, pgcrypto.

create extension if not exists "pgcrypto";

-- NOTE: private.is_org_admin(uuid) and private.is_org_member(uuid) already
-- exist in production and are intentionally NOT (re)defined here. The write
-- policy below calls private.is_org_admin(organization_id) positionally, so
-- the existing helper (parameter named target_org in prod) is used as-is.
-- Redefining it fails with 42P13 (cannot rename input parameter).

-- ---------------------------------------------------------------------------
-- public.steward_task_state  (from docs/steward-accountability-schema.sql)
-- ---------------------------------------------------------------------------
create table if not exists public.steward_task_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Stable key produced by Steward: '<origin>:<id>', e.g. 'commitment:<uuid>'.
  task_key text not null,
  -- do_now | protect_time | delegate | deprioritize
  focus text,
  -- Human ordering within the checklist. Lower sorts first.
  rank integer,
  completed_by_label text,
  completed_at timestamptz,
  completion_note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint steward_task_state_focus_check
    check (focus is null or focus in ('do_now', 'protect_time', 'delegate', 'deprioritize'))
);

create unique index if not exists steward_task_state_org_key_idx
  on public.steward_task_state (organization_id, task_key);

create index if not exists steward_task_state_org_idx
  on public.steward_task_state (organization_id);

revoke all on public.steward_task_state from anon;
revoke all on public.steward_task_state from authenticated;
grant select, insert, update, delete on public.steward_task_state to authenticated;
grant all on public.steward_task_state to service_role;

alter table public.steward_task_state enable row level security;

drop policy if exists steward_task_state_select on public.steward_task_state;
create policy steward_task_state_select
  on public.steward_task_state
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists steward_task_state_insert on public.steward_task_state;
create policy steward_task_state_insert
  on public.steward_task_state
  for insert
  to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists steward_task_state_update on public.steward_task_state;
create policy steward_task_state_update
  on public.steward_task_state
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists steward_task_state_delete on public.steward_task_state;
create policy steward_task_state_delete
  on public.steward_task_state
  for delete
  to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------------------------
-- public.organization_role_app_access  (from docs/settings-schema.sql)
-- Per-role room defaults. A grant here can never exceed the role ceiling;
-- the application clamps, and a per-person member_app_access row still wins.
-- ---------------------------------------------------------------------------
create table if not exists public.organization_role_app_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  app_key text not null,
  -- hidden | view | work | manage
  access_level text not null default 'hidden',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_role_app_access_level_check
    check (access_level in ('hidden', 'view', 'work', 'manage'))
);

create unique index if not exists organization_role_app_access_key_idx
  on public.organization_role_app_access (organization_id, role, app_key);

revoke all on public.organization_role_app_access from anon;
revoke all on public.organization_role_app_access from authenticated;
grant select, insert, update, delete on public.organization_role_app_access to authenticated;
grant all on public.organization_role_app_access to service_role;

alter table public.organization_role_app_access enable row level security;

drop policy if exists organization_role_app_access_select on public.organization_role_app_access;
create policy organization_role_app_access_select
  on public.organization_role_app_access for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists organization_role_app_access_write on public.organization_role_app_access;
create policy organization_role_app_access_write
  on public.organization_role_app_access for all to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));
