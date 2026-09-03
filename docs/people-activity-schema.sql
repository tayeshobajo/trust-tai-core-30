-- Trust Tai OS. People & access: in-app activity.
--
-- Sign-in truth already lives in auth.users.last_sign_in_at and is read
-- server-side through the governed directory endpoint. That answers "did this
-- person ever arrive". It does not answer "is this person actually working in
-- the workspace", which is a different truth and needs its own record.
--
-- This table is that record and nothing more: the last time a person opened a
-- room, per room. One row per person per room, upserted. No page-view history,
-- no analytics, no payloads.
--
-- Idempotent and additive. Safe to run more than once.

create extension if not exists "pgcrypto";

create table if not exists public.member_activity (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Which room was opened: 'scout', 'comms', 'settings', and so on.
  app_key text not null,
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create unique index if not exists member_activity_key_idx
  on public.member_activity (organization_id, user_id, app_key);

create index if not exists member_activity_recent_idx
  on public.member_activity (organization_id, last_seen_at desc);

revoke all on public.member_activity from anon;
revoke all on public.member_activity from authenticated;
grant select, insert, update on public.member_activity to authenticated;
grant all on public.member_activity to service_role;

alter table public.member_activity enable row level security;

-- Everyone in the workspace may read presence: People & access shows it, and
-- it is not sensitive beyond "this colleague opened this room".
drop policy if exists member_activity_select on public.member_activity;
create policy member_activity_select
  on public.member_activity for select to authenticated
  using (private.is_org_member(organization_id));

-- A person only ever records their own presence. Nobody writes anyone else's.
drop policy if exists member_activity_insert on public.member_activity;
create policy member_activity_insert
  on public.member_activity for insert to authenticated
  with check (user_id = auth.uid() and private.is_org_member(organization_id));

drop policy if exists member_activity_update on public.member_activity;
create policy member_activity_update
  on public.member_activity for update to authenticated
  using (user_id = auth.uid() and private.is_org_member(organization_id))
  with check (user_id = auth.uid() and private.is_org_member(organization_id));
