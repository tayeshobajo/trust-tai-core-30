-- Trust Tai OS — Conductor V2: the control ledger.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- Additive and idempotent. Requires docs/conductor-v1-schema.sql first.
--
-- Architecture note. These two tables are *governance*, not business truth.
-- They record what the Conductor prepared, what a person decided about it, and
-- what was handed to the room that owns the change. They hold references —
-- never a copy of a prospect, relationship, roadmap, project or asset. The
-- owning room remains the only writer of its own state.
--
-- Security. RLS on both tables, reusing the existing hardened
-- private.is_org_member(uuid). anon holds no privilege and appears in no
-- policy. Nothing is deletable: the audit trail is append-and-amend only.

create extension if not exists "pgcrypto";

/* ---------------------------------------------------- conductor actions */
create table if not exists public.conductor_actions (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  answer_id text,
  plan_id text,
  graph_id text,
  proposal_id text,
  owning_app text not null,
  operation text not null,
  payload jsonb,
  intent text not null,
  why_it_matters text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  depends_on jsonb not null default '[]'::jsonb,
  consequence text not null default 'internal_change'
    check (consequence in ('informational','internal_preparation','internal_change','external')),
  requires_approval boolean not null default true,
  required_capability text not null default 'workspace.read',
  route text not null default '/modules/conductor',
  route_label text not null default 'Open the owning room',
  boundary jsonb not null default '{"willDo":[],"willNotDo":[]}'::jsonb,
  expected_signal jsonb not null default '{}'::jsonb,
  source_event_key text not null,
  status text not null default 'proposed'
    check (status in ('proposed','approved','held','rejected','routed','accepted',
                      'executing','completed','failed','withdrawn','measured')),
  approval jsonb,
  routed_at timestamptz,
  receipt_id text,
  outcome jsonb,
  created_at timestamptz not null default now()
);

-- Idempotency: the same prepared action never becomes two governed rows.
create unique index if not exists conductor_actions_source_key_idx
  on public.conductor_actions (organization_id, source_event_key);

create index if not exists conductor_actions_org_status_idx
  on public.conductor_actions (organization_id, status, created_at desc);

/* --------------------------------------------------- conductor receipts */
create table if not exists public.conductor_receipts (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  action_id text not null references public.conductor_actions(id) on delete cascade,
  owning_app text not null,
  adapter_id text not null,
  boundary_crossed text not null default '',
  routed_at timestamptz not null default now(),
  approved_by jsonb not null,
  routed_by jsonb not null,
  source_event_key text not null,
  status text not null check (status in ('routed','refused','failed')),
  result jsonb,
  failure text,
  resulting_state text not null,
  created_at timestamptz not null default now()
);

-- One receipt per handover attempt key: a retried route cannot double-hand work.
create unique index if not exists conductor_receipts_source_key_idx
  on public.conductor_receipts (organization_id, source_event_key);

create index if not exists conductor_receipts_action_idx
  on public.conductor_receipts (organization_id, action_id, routed_at desc);

/* ------------------------------------------------------------- security */

alter table public.conductor_actions enable row level security;
alter table public.conductor_receipts enable row level security;

revoke all on public.conductor_actions from anon, authenticated;
revoke all on public.conductor_receipts from anon, authenticated;

grant select, insert, update on public.conductor_actions to authenticated;
grant select, insert, update on public.conductor_receipts to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_actions'
      and policyname = 'conductor_actions_member_read'
  ) then
    create policy conductor_actions_member_read on public.conductor_actions
      for select to authenticated using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_actions'
      and policyname = 'conductor_actions_member_write'
  ) then
    create policy conductor_actions_member_write on public.conductor_actions
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_actions'
      and policyname = 'conductor_actions_member_update'
  ) then
    create policy conductor_actions_member_update on public.conductor_actions
      for update to authenticated
      using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_receipts'
      and policyname = 'conductor_receipts_member_read'
  ) then
    create policy conductor_receipts_member_read on public.conductor_receipts
      for select to authenticated using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_receipts'
      and policyname = 'conductor_receipts_member_write'
  ) then
    create policy conductor_receipts_member_write on public.conductor_receipts
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'conductor_receipts'
      and policyname = 'conductor_receipts_member_update'
  ) then
    create policy conductor_receipts_member_update on public.conductor_receipts
      for update to authenticated
      using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;
end $$;
