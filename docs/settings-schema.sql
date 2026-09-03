-- Trust Tai OS. Settings: application visibility, invitations, preferences.
--
-- Idempotent and additive. It adds only what Settings genuinely owns and
-- nothing that already exists elsewhere:
--   * identity of a person        -> public.profiles
--   * identity of an organization -> public.organizations
--   * role and membership state   -> public.organization_memberships
--
-- New here:
--   organization_app_settings     which rooms exist for the organization
--   member_app_access             per-person visibility and authority overrides
--   organization_invitations      people invited but not yet members
--   user_notification_preferences what reaches a person, per workspace
--
-- Security. RLS on everywhere, policies reuse the hardened
-- private.is_org_member, and writes that change other people's access are
-- restricted to owners and admins. anon keeps no privilege at all.

create extension if not exists "pgcrypto";

-- Owner/admin test, reused by every write policy below.
create or replace function private.is_org_admin(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, private
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = _organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
      and m.role in ('owner', 'admin')
  )
$$;

revoke all on function private.is_org_admin(uuid) from public;
grant execute on function private.is_org_admin(uuid) to authenticated;

/* ------------------------------------------------ organization_app_settings */

create table if not exists public.organization_app_settings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  app_key text not null,
  enabled boolean not null default true,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists organization_app_settings_key_idx
  on public.organization_app_settings (organization_id, app_key);

revoke all on public.organization_app_settings from anon;
revoke all on public.organization_app_settings from authenticated;
grant select, insert, update, delete on public.organization_app_settings to authenticated;
grant all on public.organization_app_settings to service_role;

alter table public.organization_app_settings enable row level security;

drop policy if exists organization_app_settings_select on public.organization_app_settings;
create policy organization_app_settings_select
  on public.organization_app_settings for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists organization_app_settings_write on public.organization_app_settings;
create policy organization_app_settings_write
  on public.organization_app_settings for all to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

/* -------------------------------------------------------- member_app_access */

create table if not exists public.member_app_access (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  app_key text not null,
  -- hidden | view | work | manage
  access_level text not null default 'hidden',
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint member_app_access_level_check
    check (access_level in ('hidden', 'view', 'work', 'manage'))
);

create unique index if not exists member_app_access_key_idx
  on public.member_app_access (organization_id, user_id, app_key);

revoke all on public.member_app_access from anon;
revoke all on public.member_app_access from authenticated;
grant select, insert, update, delete on public.member_app_access to authenticated;
grant all on public.member_app_access to service_role;

alter table public.member_app_access enable row level security;

-- A member may read access rows for their own organization: the shell needs
-- their own row, and People & access shows the rest to those who can see it.
drop policy if exists member_app_access_select on public.member_app_access;
create policy member_app_access_select
  on public.member_app_access for select to authenticated
  using (private.is_org_member(organization_id));

-- Only owners and admins may grant or remove access. Nobody widens their own.
drop policy if exists member_app_access_write on public.member_app_access;
create policy member_app_access_write
  on public.member_app_access for all to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

/* -------------------------------------------------- organization_invitations */

create table if not exists public.organization_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role text not null default 'team_member',
  app_access jsonb not null default '{}'::jsonb,
  -- pending | accepted | cancelled | expired
  status text not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  last_sent_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  constraint organization_invitations_status_check
    check (status in ('pending', 'accepted', 'cancelled', 'expired'))
);

create unique index if not exists organization_invitations_email_idx
  on public.organization_invitations (organization_id, email);

revoke all on public.organization_invitations from anon;
revoke all on public.organization_invitations from authenticated;
grant select, insert, update, delete on public.organization_invitations to authenticated;
grant all on public.organization_invitations to service_role;

alter table public.organization_invitations enable row level security;

drop policy if exists organization_invitations_select on public.organization_invitations;
create policy organization_invitations_select
  on public.organization_invitations for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists organization_invitations_write on public.organization_invitations;
create policy organization_invitations_write
  on public.organization_invitations for all to authenticated
  using (private.is_org_admin(organization_id))
  with check (private.is_org_admin(organization_id));

/* ------------------------------------------- user_notification_preferences */

create table if not exists public.user_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists user_notification_preferences_key_idx
  on public.user_notification_preferences (user_id, organization_id);

revoke all on public.user_notification_preferences from anon;
revoke all on public.user_notification_preferences from authenticated;
grant select, insert, update, delete on public.user_notification_preferences to authenticated;
grant all on public.user_notification_preferences to service_role;

alter table public.user_notification_preferences enable row level security;

-- Strictly personal. Nobody reads or writes another person's preferences.
drop policy if exists user_notification_preferences_select on public.user_notification_preferences;
create policy user_notification_preferences_select
  on public.user_notification_preferences for select to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id));

drop policy if exists user_notification_preferences_write on public.user_notification_preferences;
create policy user_notification_preferences_write
  on public.user_notification_preferences for all to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id))
  with check (user_id = auth.uid() and private.is_org_member(organization_id));

/* ------------------------------------------------- optional profile columns */
-- Settings writes these when they exist and silently skips them when they do
-- not, so this block is safe to run on an already-populated profiles table.

alter table public.profiles add column if not exists preferred_name text;
alter table public.profiles add column if not exists job_title text;
alter table public.profiles add column if not exists timezone text;
alter table public.profiles add column if not exists locale text;

alter table public.organizations add column if not exists website_url text;
alter table public.organizations add column if not exists logo_url text;
alter table public.organizations add column if not exists timezone text;

/* ---------------------------------------- organization_role_app_access */
-- Per-role room defaults. A grant here can never exceed what the role's
-- permissions already carry; the application clamps to the role ceiling and
-- a per-person member_app_access row still wins over this default.

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
