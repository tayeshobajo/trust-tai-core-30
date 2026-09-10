-- Trust Tai OS, the Conductor's own three tables.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- Additive and idempotent: a fresh environment reaches the same end state.
--
-- Architecture note. The Conductor owns no business entity. These tables hold
-- only what a person decided or corrected, outcomes, hand-recorded figures,
-- and corrections to the Conductor's own answers. No prospect, relationship,
-- roadmap, project or Ops record is duplicated here. Every other number the
-- Conductor says out loud is read live from the room that owns it.
--
-- Security. Every policy reuses the existing hardened private.is_org_member(uuid).
-- RLS is enabled on all three tables, anon holds no privilege and appears in no
-- policy, and default public-schema grants are revoked before anything is
-- granted back.

create extension if not exists "pgcrypto";

/* ------------------------------------------------------ business intents */
-- What the business decided to achieve. Decided truth, never inferred.
create table if not exists public.business_intents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  label text not null,
  target numeric,
  unit text,
  horizon text not null,
  because text not null default '',
  critical boolean not null default false,
  decided_by uuid not null references auth.users(id),
  decided_at timestamptz not null default now(),
  retired_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists business_intents_org_idx
  on public.business_intents (organization_id, decided_at desc);

/* ------------------------------------------------------ business figures */
-- Numbers no room can count: cash, burn, receivables, close rate, deal size.
-- Append-only. A newer as_of supersedes an older one; nothing is edited.
create table if not exists public.business_figures (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value numeric not null,
  unit text,
  basis text not null default 'decided' check (basis in ('decided', 'observed')),
  as_of timestamptz not null,
  note text,
  recorded_by uuid not null references auth.users(id),
  recorded_at timestamptz not null default now()
);

create index if not exists business_figures_org_key_idx
  on public.business_figures (organization_id, key, as_of desc);

/* -------------------------------------------------- conductor corrections */
-- The learning loop. Append-only, with a name and a reason on every row.
create table if not exists public.conductor_corrections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('wrong_figure', 'wrong_read', 'already_handled', 'not_useful')),
  answer_id text,
  question text,
  topic text,
  subject_key text,
  figure jsonb,
  note text not null default '',
  corrected_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists conductor_corrections_org_idx
  on public.conductor_corrections (organization_id, created_at desc);

/* ------------------------------------------------------------- security */

alter table public.business_intents enable row level security;
alter table public.business_figures enable row level security;
alter table public.conductor_corrections enable row level security;

revoke all on public.business_intents from anon, authenticated;
revoke all on public.business_figures from anon, authenticated;
revoke all on public.conductor_corrections from anon, authenticated;

grant select, insert, update on public.business_intents to authenticated;
grant select, insert on public.business_figures to authenticated;
grant select, insert on public.conductor_corrections to authenticated;

grant all on public.business_intents to service_role;
grant all on public.business_figures to service_role;
grant all on public.conductor_corrections to service_role;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'business_intents' and policyname = 'business_intents_read') then
    create policy business_intents_read on public.business_intents
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'business_intents' and policyname = 'business_intents_write') then
    create policy business_intents_write on public.business_intents
      for insert to authenticated with check (private.is_org_member(organization_id) and decided_by = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where tablename = 'business_intents' and policyname = 'business_intents_update') then
    create policy business_intents_update on public.business_intents
      for update to authenticated using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;

  if not exists (select 1 from pg_policies where tablename = 'business_figures' and policyname = 'business_figures_read') then
    create policy business_figures_read on public.business_figures
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'business_figures' and policyname = 'business_figures_write') then
    create policy business_figures_write on public.business_figures
      for insert to authenticated with check (private.is_org_member(organization_id) and recorded_by = auth.uid());
  end if;

  if not exists (select 1 from pg_policies where tablename = 'conductor_corrections' and policyname = 'conductor_corrections_read') then
    create policy conductor_corrections_read on public.conductor_corrections
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'conductor_corrections' and policyname = 'conductor_corrections_write') then
    create policy conductor_corrections_write on public.conductor_corrections
      for insert to authenticated with check (private.is_org_member(organization_id) and corrected_by = auth.uid());
  end if;
end $$;
