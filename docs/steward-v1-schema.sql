-- Trust Tai OS — Steward v1 schema (additive).
--
-- Run this against the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- It adds only Steward-owned tables. It does not touch profiles, organizations,
-- organization_memberships, clients, contacts, projects, prospects, activities
-- or decisions: those stay canonical and Steward references them by id.
--
-- Every table is organization scoped, RLS enforced through the existing
-- organization_memberships boundary, and granted explicitly for the Data API.

create extension if not exists "pgcrypto";

-- Membership check used by every policy below. Security definer so a policy on
-- a Steward table never has to read organization_memberships through RLS.
create or replace function public.steward_is_member(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = _organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  )
$$;

/* ----------------------------------------------------------- conversations */

create table if not exists public.steward_conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
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

grant select, insert, update, delete on public.steward_conversations to authenticated;
grant all on public.steward_conversations to service_role;
alter table public.steward_conversations enable row level security;

create policy "members read conversations"
  on public.steward_conversations for select to authenticated
  using (public.steward_is_member(organization_id));
create policy "members write conversations"
  on public.steward_conversations for insert to authenticated
  with check (public.steward_is_member(organization_id));
create policy "members update conversations"
  on public.steward_conversations for update to authenticated
  using (public.steward_is_member(organization_id))
  with check (public.steward_is_member(organization_id));

/* ------------------------------------------------------------- commitments */

create table if not exists public.steward_commitments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid references public.steward_conversations(id) on delete set null,
  -- Stable key from the transcript line. Confirming twice updates, never duplicates.
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
  -- References to canonical truth. Steward never copies these records.
  project_id uuid references public.projects(id) on delete set null,
  decision_id uuid references public.decisions(id) on delete set null,
  evidence jsonb not null default '[]'::jsonb,
  confirmed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, source_key)
);

create index if not exists steward_commitments_org_status_idx
  on public.steward_commitments (organization_id, status, due_at);

grant select, insert, update, delete on public.steward_commitments to authenticated;
grant all on public.steward_commitments to service_role;
alter table public.steward_commitments enable row level security;

create policy "members read commitments"
  on public.steward_commitments for select to authenticated
  using (public.steward_is_member(organization_id));
create policy "members write commitments"
  on public.steward_commitments for insert to authenticated
  with check (public.steward_is_member(organization_id));
create policy "members update commitments"
  on public.steward_commitments for update to authenticated
  using (public.steward_is_member(organization_id))
  with check (public.steward_is_member(organization_id));

/* ------------------------------------------------------------ role memory */

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

grant select, insert, update, delete on public.steward_role_memory to authenticated;
grant all on public.steward_role_memory to service_role;
alter table public.steward_role_memory enable row level security;

create policy "members read role memory"
  on public.steward_role_memory for select to authenticated
  using (public.steward_is_member(organization_id));
create policy "members write role memory"
  on public.steward_role_memory for insert to authenticated
  with check (public.steward_is_member(organization_id));
create policy "members update role memory"
  on public.steward_role_memory for update to authenticated
  using (public.steward_is_member(organization_id))
  with check (public.steward_is_member(organization_id));

/* ---------------------------------------------------------------- beliefs */

-- Memory is append only. A correction supersedes; nothing is deleted, so the
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

grant select, insert on public.steward_beliefs to authenticated;
grant all on public.steward_beliefs to service_role;
alter table public.steward_beliefs enable row level security;

create policy "members read beliefs"
  on public.steward_beliefs for select to authenticated
  using (public.steward_is_member(organization_id));
create policy "members write beliefs"
  on public.steward_beliefs for insert to authenticated
  with check (public.steward_is_member(organization_id));
