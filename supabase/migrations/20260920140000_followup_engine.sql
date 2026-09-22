-- Move A — Follow-up Engine state.
--
-- The Relationships production line's "Follow up" station. Tracks where each
-- relationship sits in the follow-up cadence so the daily sweep is idempotent
-- (never drafts the same touch twice) and the /modules/pulse board can list
-- what is due and what has gone cold.
--
-- Doctrine: this table records intent to follow up. It never sends. The sweep
-- writes gated drafts (comms_drafts, needs_human_review) and reminders
-- (comms_reminders). Tai's approval is the send.
--
-- Cadence (Tai, 2026-09-20): touch 1 at day 4, touch 2 at day 10, cold after
-- touch 2 unanswered.

create table if not exists public.comms_followup_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  relationship_id uuid not null,
  -- 0 = no follow-up drafted yet; 1 = touch-1 drafted; 2 = touch-2 drafted.
  last_touch_no int not null default 0,
  -- active = still chasing; replied = they came back (stop); cold = exhausted cadence.
  state text not null default 'active',
  -- the outbound we are following up on; anchors the day-4/day-10 clock.
  anchor_outbound_at timestamptz,
  -- when the next touch becomes due (null once cold/replied).
  next_due_at timestamptz,
  -- last time the sweep touched this row (double-fire guard within a run window).
  last_swept_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_followup_state_state_chk
    check (state in ('active','replied','cold')),
  constraint comms_followup_state_touch_chk
    check (last_touch_no between 0 and 2),
  constraint comms_followup_state_uniq
    unique (organization_id, relationship_id)
);

create index if not exists comms_followup_state_org_state_idx
  on public.comms_followup_state (organization_id, state);
create index if not exists comms_followup_state_due_idx
  on public.comms_followup_state (organization_id, next_due_at)
  where state = 'active';
create index if not exists comms_followup_state_rel_idx
  on public.comms_followup_state (relationship_id);

alter table public.comms_followup_state enable row level security;

-- RLS mirrors the comms core pattern exactly (see comms_drafts): org members
-- read/write/update via private.is_org_member(organization_id); service_role full.
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='comms_followup_state'
      and policyname='Members read followup state'
  ) then
    create policy "Members read followup state"
      on public.comms_followup_state for select
      using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='comms_followup_state'
      and policyname='Members write followup state'
  ) then
    create policy "Members write followup state"
      on public.comms_followup_state for insert
      with check (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='comms_followup_state'
      and policyname='Members update followup state'
  ) then
    create policy "Members update followup state"
      on public.comms_followup_state for update
      using (private.is_org_member(organization_id));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname='public' and tablename='comms_followup_state'
      and policyname='comms_followup_state_service_role'
  ) then
    create policy comms_followup_state_service_role
      on public.comms_followup_state for all
      using (auth.role() = 'service_role');
  end if;
end $$;
