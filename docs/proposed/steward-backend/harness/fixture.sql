-- Disposable fixture: Supabase-compatible auth shim, orgs, memberships,
-- canonical tasks, conversations, proposals. Mirrors the cmd-task-manager
-- harness contracts (auth.uid from request.jwt.claims, private membership
-- helpers, active/status/role model).
do $$ begin
  if current_database() = 'postgres' and current_setting('server_version_num')::int < 0 then
    raise exception 'unreachable guard';
  end if;
end $$;

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

-- Canonical board tasks, mirroring the inspected steward_tasks contract.
create table public.steward_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  notes text not null default '',
  task_visibility text not null default 'business',
  owner_user_id uuid,
  created_by uuid,
  status text not null default 'open',
  completion_evidence text not null default '',
  completed_at timestamptz,
  completed_by uuid,
  archived_at timestamptz,
  revision integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.steward_conversations (
  id uuid primary key,
  organization_id uuid not null,
  title text not null,
  transcript_text text not null default '',
  transcript_hash text,
  transcript_revision integer not null default 1
);

create table public.steward_proposals (
  id uuid primary key,
  organization_id uuid not null,
  conversation_id uuid not null,
  statement text not null,
  source_offset integer
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
  (id, organization_id, title, notes, task_visibility, owner_user_id, created_by, status, archived_at) values
  ('10000000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'Prepare Soji handoff', 'Recorded notes for the handoff task.', 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  ('10000000-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'Member-owned task', 'Notes owned by the member fixture.', 'business',
   'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'open', null),
  ('10000000-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'Archived required task', 'Archived but still required scope.', 'business',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', now()),
  ('10000000-0000-0000-0000-000000000004', '11111111-1111-1111-1111-111111111111',
   'Personal task', 'Private notes must not leak.', 'personal',
   'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'open', null),
  ('10000000-0000-0000-0000-000000000009', '22222222-2222-2222-2222-222222222222',
   'Cross-org task', 'Belongs to org B.', 'business',
   'cccccccc-cccc-cccc-cccc-cccccccccccc', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'open', null);

insert into public.steward_conversations
  (id, organization_id, title, transcript_text, transcript_hash, transcript_revision) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-1111-1111-1111-111111111111',
   'Soji roadmap call', 'Ordered synthetic transcript text for the Soji call.',
   'transcript-hash-v1-abcdef0123456789', 1),
  ('dddddddd-dddd-dddd-dddd-dddddddddd01', '22222222-2222-2222-2222-222222222222',
   'Org B call', 'Org B transcript.', 'transcript-hash-b1-abcdef0123456789', 1);

insert into public.steward_proposals
  (id, organization_id, conversation_id, statement, source_offset) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Roadmap proposal at 39:48', 2388),
  ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-1111-1111-1111-111111111111',
   'dddddddd-dddd-dddd-dddd-dddddddddddd', 'Mockup proposal at 53:57', 3237),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeee001', '22222222-2222-2222-2222-222222222222',
   'dddddddd-dddd-dddd-dddd-dddddddddd01', 'Org B proposal', 10);

grant select, insert, update, delete on public.organizations,
  public.organization_memberships, public.steward_tasks,
  public.steward_conversations, public.steward_proposals
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
