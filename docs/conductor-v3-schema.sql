-- Trust Tai OS — Conductor V3: the outcome and learning ledger.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- Additive and idempotent. Requires docs/conductor-v2-schema.sql first.
--
-- Architecture note. Both tables are *intelligence*, not business truth.
-- `conductor_observations` records what was found in an owning room when an
-- expected signal was checked. `conductor_learning` records what the Conductor
-- concluded about its own recommendations. Neither copies a prospect,
-- relationship, roadmap, project or asset — only references and the evidence
-- sentences behind a reading.
--
-- Laws encoded here:
--   * Append-only. A changed conclusion is a new row that supersedes the old.
--   * Observation is not causation: a row says what was seen, never why.
--   * Learning never grants authority — there is no permission column, and
--     none may be added.
--
-- Security. RLS on both tables, reusing the existing hardened
-- private.is_org_member(uuid). anon holds no privilege and appears in no
-- policy. No delete and no update grant: audit history is immutable.

create extension if not exists "pgcrypto";

/* ----------------------------------------------- conductor observations */
create table if not exists public.conductor_observations (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id text not null references public.conductor_actions(id) on delete cascade,
  recommendation_id text,
  answer_id text,
  plan_id text,
  owning_app text not null,
  operation text not null,
  expected_signal jsonb not null default '{}'::jsonb,
  observation_window jsonb,
  observed_evidence jsonb not null default '[]'::jsonb,
  result text not null default 'unknown'
    check (result in ('signal_present','signal_absent','partial','not_measurable','unknown')),
  truth text not null default 'unknown'
    check (truth in ('observed','decided','inferred','recommended','unknown')),
  confidence text not null default 'unknown'
    check (confidence in ('high','moderate','low','unknown')),
  metric_key text,
  metric_class text check (metric_class in ('output','leading','lagging')),
  outcome_status text not null default 'pending'
    check (outcome_status in ('pending','measured','inconclusive')),
  measured_at timestamptz not null default now(),
  observed_at timestamptz,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists conductor_observations_org_action_idx
  on public.conductor_observations (organization_id, action_id, measured_at desc);

create index if not exists conductor_observations_scope_idx
  on public.conductor_observations (organization_id, owning_app, operation, measured_at desc);

/* --------------------------------------------------- conductor learning */
create table if not exists public.conductor_learning (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  owning_app text not null,
  operation text not null,
  source_action_ids jsonb not null default '[]'::jsonb,
  source_observation_ids jsonb not null default '[]'::jsonb,
  recommendation_id text,
  hypothesis text not null default '',
  expected_signal text not null default '',
  observed_result text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  confidence text not null default 'none'
    check (confidence in ('none','low','moderate','high')),
  lesson text not null,
  -- A human correction is 'decided' and outranks anything inferred.
  basis text not null default 'inferred'
    check (basis in ('observed','decided','inferred','recommended','unknown')),
  -- One result is never a rule; the writer sets this only past the threshold.
  is_rule boolean not null default false,
  recorded_at timestamptz not null default now(),
  supersedes text references public.conductor_learning(id) on delete set null,
  contradicts text references public.conductor_learning(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists conductor_learning_scope_idx
  on public.conductor_learning (organization_id, owning_app, operation, recorded_at desc);

/* ------------------------------------------------------------- security */

alter table public.conductor_observations enable row level security;
alter table public.conductor_learning enable row level security;

revoke all on public.conductor_observations from anon, authenticated;
revoke all on public.conductor_learning from anon, authenticated;

-- Read and append only. No update, no delete: this history is evidence.
grant select, insert on public.conductor_observations to authenticated;
grant select, insert on public.conductor_learning to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_observations'
      and policyname = 'conductor_observations_member_read'
  ) then
    create policy conductor_observations_member_read on public.conductor_observations
      for select to authenticated using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_observations'
      and policyname = 'conductor_observations_member_write'
  ) then
    create policy conductor_observations_member_write on public.conductor_observations
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_learning'
      and policyname = 'conductor_learning_member_read'
  ) then
    create policy conductor_learning_member_read on public.conductor_learning
      for select to authenticated using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_learning'
      and policyname = 'conductor_learning_member_write'
  ) then
    create policy conductor_learning_member_write on public.conductor_learning
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;
end $$;

-- Data API privileges (required in addition to RLS; idempotent)
grant select, insert on public.conductor_observations to authenticated;
grant select, insert on public.conductor_learning to authenticated;
grant all on public.conductor_observations to service_role;
grant all on public.conductor_learning to service_role;
