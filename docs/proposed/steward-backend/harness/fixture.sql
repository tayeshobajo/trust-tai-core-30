-- Disposable fixture: Supabase-compatible auth shim, orgs, memberships,
-- canonical tasks and conversations. Mirrors the REAL repo contracts:
-- public.steward_tasks from supabase/migrations/20260921160000 (plus the
-- additive columns 001 proposes) and public.conversations from
-- docs/steward-v1-schema.sql (transcript jsonb, no hash/revision columns).
create extension if not exists pgcrypto;
create extension if not exists "uuid-ossp";

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema if not exists auth;
create schema if not exists private;
grant usage on schema private to authenticated, service_role;
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
  )::uuid
$$;
create or replace function auth.role() returns text language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
$$;

grant usage on schema public, auth to authenticated, anon, service_role;

create table public.organizations (id uuid primary key, slug text);
create table public.organization_memberships (
  organization_id uuid, user_id uuid, status text, role text
);

-- Real conversation contract: transcript jsonb (NormalizedConversation).
create table public.conversations (
  id uuid primary key,
  organization_id uuid not null,
  source_provider text not null default 'fathom',
  source_external_id text not null default 'fixture',
  title text not null,
  occurred_at timestamptz not null default now(),
  participants jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Canonical board tasks: real 20260921160000 columns plus the additive
-- columns proposed in 001 (added there via alter table; pre-created here
-- so the fixture matches the post-patch shape).
create table public.steward_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  notes text,
  correlation_id text,
  owner_user_id uuid,
  created_by uuid,
  status text not null default 'open',
  revision integer not null default 0,
  task_visibility text not null default 'business',
  completion_evidence text,
  completed_at timestamptz,
  completed_by uuid,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Identities.
-- org_a  11111111-...   org_b 22222222-...
-- owner  aaaaaaaa-... (org_a active owner)
-- member bbbbbbbb-... (org_a active member)
-- viewer dddddd00-... (org_a active viewer — read-only role)
-- inactv eeeeee00-... (org_a INACTIVE member)
-- cross  cccccccc-... (org_b active member)
insert into public.organizations values
  ('11111111-1111-1111-1111-111111111111', 'org-a'),
  ('22222222-2222-2222-2222-222222222222', 'org-b');
insert into public.organization_memberships values
  ('11111111-1111-1111-1111-111111111111', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'active', 'owner'),
  ('11111111-1111-1111-1111-111111111111', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'active', 'member'),
  ('11111111-1111-1111-1111-111111111111', 'dddddd00-0000-0000-0000-000000000001', 'active', 'viewer'),
  ('11111111-1111-1111-1111-111111111111', 'eeeeee00-0000-0000-0000-000000000001', 'inactive', 'member'),
  ('22222222-2222-2222-2222-222222222222', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'active', 'member');

insert into public.steward_tasks
  (id, organization_id, title, notes, correlation_id, task_visibility, owner_user_id, created_by, status, archived_at) values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Prepare Soji handoff', 'Recorded notes for the handoff task.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Member-owned task', 'Notes owned by the member fixture.', null, 'business',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'open', null),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Archived required task', 'Archived but still required scope.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', now()),
  ('10000000-0000-0000-0000-000000000005', '11111111-1111-1111-1111-111111111111',
   'Coverage test task', 'Used only by the coverage suite.', null, 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  -- Required-manual task correlated to the Soji conversation (sync seed).
  ('10000000-0000-0000-0000-000000000006', '11111111-1111-1111-1111-111111111111',
   'Manually added required task', 'Added from the meeting workroom.',
   'dddddddd-dddd-dddd-dddd-dddddddddddd/30000000-0000-0000-0000-000000000001', 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  ('10000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Personal task', 'Private notes must not leak.', null, 'personal',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  ('10000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
   'Cross-org task', 'Belongs to org B.', null, 'business',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'open', null);

insert into public.conversations
  (id, organization_id, title, transcript) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
   'Soji roadmap call',
   '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb),
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', '22222222-2222-2222-2222-222222222222',
   'Org B call',
   '{"segments":[{"speaker":"Other","text":"Org B transcript.","offset":0}]}'::jsonb);

grant select, insert, update, delete on public.organizations,
  public.organization_memberships, public.steward_tasks, public.conversations
  to authenticated, service_role;

-- Test helpers.
create or replace function public.test_assert(ok boolean, label text) returns void
language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAILED: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

create or replace function public.test_denied(statement text, label text) returns void
language plpgsql as $$
declare rejected boolean := false;
begin
  begin
    execute statement;
  exception
    when others then rejected := true;
  end;
  if not rejected then raise exception 'FAILED expected rejection: %', label; end if;
  raise notice 'PASS: %', label;
end $$;

-- Act as a fixture user: set role + JWT claim in one call.
create or replace function public.test_act_as(user_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', user_id::text, false);
  perform set_config('request.jwt.claim.role', 'authenticated', false);
end $$;

-- Act as the server worker: service_role credential, no user identity.
create or replace function public.test_act_as_worker() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('request.jwt.claim.sub', '', false);
  perform set_config('request.jwt.claim.role', 'service_role', false);
end $$;
