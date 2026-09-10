-- Trust Tai OS. P1 commercial truth foundation.
--
-- Idempotent and additive. Nothing is renamed, nothing is dropped, nothing is
-- seeded and no row is written. Every new column is nullable, so an existing
-- row stays exactly as honest as it was before this ran.
--
-- Where each concept lives, and why there is no new core entity:
--   recurring commercial state of a company -> public.clients (canonical)
--   a proposal                              -> public.roadmaps, the existing
--                                              prospect -> roadmap lineage,
--                                              which already carries
--                                              prospect_id, relationship_id
--                                              and client_id
--   the kind of a logged meeting            -> public.comms_touches, the
--                                              canonical touch record
--   what a good week looks like             -> public.organization_weekly_targets
--                                              (new, configuration only)
--
-- Weekly revenue is never stored. Run weekly is derived at read time as
-- mrr_cents * 12 / 52 (src/domain/revenue.ts). One-off revenue is an event:
-- proposal.signed and client.tier_changed carry the amount in public.activities.
--
-- Security. RLS stays on everywhere, policies reuse the hardened
-- private.is_org_member and private.is_org_admin. anon receives no privilege.

/* ------------------------------------------------ 1. client commercial state */

alter table public.clients
  add column if not exists tier text,
  add column if not exists mrr_cents bigint,
  add column if not exists renewal_at timestamptz,
  add column if not exists next_review_at timestamptz,
  add column if not exists tier_changed_at timestamptz,
  add column if not exists commercial_updated_by uuid references auth.users(id),
  add column if not exists commercial_updated_at timestamptz,
  add column if not exists commercial_provenance jsonb;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'clients_tier_check'
  ) then
    alter table public.clients
      add constraint clients_tier_check
      check (tier is null or tier in ('diagnose', 'build', 'run', 'none'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'clients_mrr_cents_check'
  ) then
    alter table public.clients
      add constraint clients_mrr_cents_check
      check (mrr_cents is null or mrr_cents >= 0);
  end if;
end
$$;

create index if not exists clients_tier_idx
  on public.clients (organization_id, tier);
create index if not exists clients_next_review_at_idx
  on public.clients (organization_id, next_review_at);

comment on column public.clients.mrr_cents is
  'Recurring monthly revenue in cents. Weekly revenue is derived at read time as mrr_cents * 12 / 52 and is never stored.';
comment on column public.clients.next_review_at is
  'Satisfied only by a logged roadmap_review meeting. Never advanced automatically.';

/* --------------------------------- 2. proposal on the prospect -> roadmap lineage */

alter table public.roadmaps
  add column if not exists proposal_sent_at timestamptz,
  add column if not exists proposal_amount_cents bigint,
  add column if not exists proposal_outcome text,
  add column if not exists proposal_outcome_at timestamptz,
  add column if not exists proposal_updated_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roadmaps_proposal_outcome_check'
  ) then
    alter table public.roadmaps
      add constraint roadmaps_proposal_outcome_check
      check (proposal_outcome is null or proposal_outcome in ('open', 'signed', 'declined'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'roadmaps_proposal_amount_check'
  ) then
    alter table public.roadmaps
      add constraint roadmaps_proposal_amount_check
      check (proposal_amount_cents is null or proposal_amount_cents >= 0);
  end if;
end
$$;

create index if not exists roadmaps_proposal_sent_at_idx
  on public.roadmaps (organization_id, proposal_sent_at);

comment on column public.roadmaps.proposal_amount_cents is
  'Human-entered proposal amount in cents. Never derived, never inferred from a document.';

/* --------------------------------------------- 3. meeting kind on a logged touch */

alter table public.comms_touches
  add column if not exists meeting_kind text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'comms_touches_meeting_kind_check'
  ) then
    alter table public.comms_touches
      add constraint comms_touches_meeting_kind_check
      check (meeting_kind is null or meeting_kind in ('discovery', 'roadmap_review', 'delivery', 'other'));
  end if;
end
$$;

create index if not exists comms_touches_meeting_kind_idx
  on public.comms_touches (organization_id, meeting_kind, occurred_at);

comment on column public.comms_touches.meeting_kind is
  'Human set only. Never inferred from a subject line, a calendar entry, Fathom or a transcript.';

/* -------------------------------------------- 4. organization weekly targets */

create table if not exists public.organization_weekly_targets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_touch_target_low integer not null default 10,
  first_touch_target_high integer not null default 12,
  discovery_target_low integer not null default 2,
  discovery_target_high integer not null default 3,
  diagnose_proposals_target_low integer not null default 1,
  diagnose_proposals_target_high integer not null default 2,
  run_clients_target integer not null default 20,
  revenue_target_cents bigint,
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id)
);

comment on table public.organization_weekly_targets is
  'Configuration only: what a good week looks like. Never holds an actual; actuals are derived at read time.';

grant select, insert, update, delete on public.organization_weekly_targets to authenticated;
grant all on public.organization_weekly_targets to service_role;

alter table public.organization_weekly_targets enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_weekly_targets'
      and policyname = 'weekly targets readable by members'
  ) then
    execute 'create policy "weekly targets readable by members"
             on public.organization_weekly_targets for select to authenticated
             using (private.is_org_member(organization_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_weekly_targets'
      and policyname = 'weekly targets written by admins'
  ) then
    execute 'create policy "weekly targets written by admins"
             on public.organization_weekly_targets for insert to authenticated
             with check (private.is_org_admin(organization_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_weekly_targets'
      and policyname = 'weekly targets updated by admins'
  ) then
    execute 'create policy "weekly targets updated by admins"
             on public.organization_weekly_targets for update to authenticated
             using (private.is_org_admin(organization_id))
             with check (private.is_org_admin(organization_id))';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'organization_weekly_targets'
      and policyname = 'weekly targets removed by admins'
  ) then
    execute 'create policy "weekly targets removed by admins"
             on public.organization_weekly_targets for delete to authenticated
             using (private.is_org_admin(organization_id))';
  end if;
end
$$;
