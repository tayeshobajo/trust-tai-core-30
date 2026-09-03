-- Trust Tai OS, canonical conversations + commitments, and Steward context.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf),
-- together with a follow-up grant-hardening pass that is now folded in below.
-- The file is additive and idempotent: a fresh environment reaches the same
-- secure end state in this one migration.
--
-- Architecture note. Conversations and commitments are canonical shared truth,
-- not Steward property. Steward is simply the first room that produces and
-- consumes them; Comms, Projects, Pulse, Gmail, PLAUD, Slack and Teams use the
-- same rows later with no renaming. Only role memory and the belief ledger stay
-- Steward specific, because they are specialised Steward context.
--
-- Security. Every policy reuses the existing hardened private.is_org_member(uuid).
-- This migration adds no privileged helper of its own and enables RLS on every
-- new table.
--
-- Grants. Supabase applies default privileges to the public schema, so a new
-- table can inherit broad anon/authenticated rights that this file never asked
-- for. Every table below therefore REVOKES ALL from anon and authenticated
-- first, then grants back only the verbs the room actually needs. The
-- unauthenticated role keeps no privilege and appears in no policy.

create extension if not exists "pgcrypto";

/* --------------------------------------------------------- conversations */

-- Source agnostic. source_provider is any adapter ('fathom', 'gmail', 'manual',
-- 'plaud', 'slack', 'teams', 'calendar'); no provider semantics are baked in.
create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_app text,
  source_provider text not null,
  source_external_id text not null,
  source_url text,
  title text not null,
  occurred_at timestamptz not null,
  participants jsonb not null default '[]'::jsonb,
  transcript jsonb not null default '{}'::jsonb,
  source_summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_provider, source_external_id)
);

create index if not exists conversations_org_occurred_idx
  on public.conversations (organization_id, occurred_at desc);

-- No delete: a conversation that was read stays readable as evidence.
revoke all privileges on table public.conversations from anon;
revoke all privileges on table public.conversations from authenticated;
grant select, insert, update on table public.conversations to authenticated;
grant all on table public.conversations to service_role;
alter table public.conversations enable row level security;

create policy "members read conversations"
  on public.conversations for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members write conversations"
  on public.conversations for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "members update conversations"
  on public.conversations for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* ---------------------------------------------------------- commitments */

-- A promise a person made, wherever it was made. Canonical work is referenced,
-- never copied: project_id and decision_id point at the existing tables.
create table if not exists public.commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.conversations(id) on delete set null,
  -- Which room recorded it, and which adapter it came through.
  source_app text,
  source_provider text,
  -- Stable key from the source line. Confirming twice updates, never duplicates.
  source_key text not null,
  kind text not null default 'action',
  statement text not null,
  owner_name text not null,
  owner_email text,
  owner_user_id uuid references auth.users(id) on delete set null,
  beneficiary text,
  -- Only ever set by a person. Extraction never writes a date.
  due_at timestamptz,
  -- What was said about timing, verbatim.
  due_text text,
  status text not null default 'open'
    check (status in ('open', 'waiting', 'kept', 'released')),
  project_id uuid references public.projects(id) on delete set null,
  decision_id uuid references public.decisions(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

create index if not exists commitments_org_status_idx
  on public.commitments (organization_id, status, due_at);
create index if not exists commitments_org_project_idx
  on public.commitments (organization_id, project_id);

-- No delete: a promise is released by status, never erased.
revoke all privileges on table public.commitments from anon;
revoke all privileges on table public.commitments from authenticated;
grant select, insert, update on table public.commitments to authenticated;
grant all on table public.commitments to service_role;
alter table public.commitments enable row level security;

create policy "members read commitments"
  on public.commitments for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members write commitments"
  on public.commitments for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "members update commitments"
  on public.commitments for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* ------------------------------------------------- steward role memory */

create table if not exists public.steward_role_memory (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  person_key text not null,
  user_id uuid references auth.users(id) on delete set null,
  name text not null,
  email text,
  title text,
  pod text,
  responsibilities jsonb not null default '[]'::jsonb,
  cadence jsonb not null default '[]'::jsonb,
  project_ids jsonb not null default '[]'::jsonb,
  notes jsonb not null default '[]'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, person_key)
);

revoke all privileges on table public.steward_role_memory from anon;
revoke all privileges on table public.steward_role_memory from authenticated;
grant select, insert, update on table public.steward_role_memory to authenticated;
grant all on table public.steward_role_memory to service_role;
alter table public.steward_role_memory enable row level security;

create policy "members read role memory"
  on public.steward_role_memory for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members write role memory"
  on public.steward_role_memory for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "members update role memory"
  on public.steward_role_memory for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* ---------------------------------------------------- steward beliefs */

-- Append only. A correction supersedes; nothing is deleted or edited, so the
-- workspace can always show what was believed, and who changed it.
create table if not exists public.steward_beliefs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_key text not null,
  subject_label text,
  statement text not null,
  tier text not null check (tier in ('observed', 'inferred', 'decided')),
  authority text not null check (authority in ('source', 'human')),
  supersedes_id uuid references public.steward_beliefs(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  recorded_by uuid references auth.users(id) on delete set null,
  recorded_by_name text,
  created_at timestamptz not null default now()
);

create index if not exists steward_beliefs_org_subject_idx
  on public.steward_beliefs (organization_id, subject_key, created_at desc);

-- Read and append only: no update, no delete.
revoke all privileges on table public.steward_beliefs from anon;
revoke all privileges on table public.steward_beliefs from authenticated;
grant select, insert on table public.steward_beliefs to authenticated;
grant all on table public.steward_beliefs to service_role;
alter table public.steward_beliefs enable row level security;

create policy "members read beliefs"
  on public.steward_beliefs for select to authenticated
  using (private.is_org_member(organization_id));
create policy "members write beliefs"
  on public.steward_beliefs for insert to authenticated
  with check (private.is_org_member(organization_id));
