-- Trust Tai OS, P3-02: milestone outcome measurements.
--
-- Additive and idempotent. One canonical history table, owned by Roadmap.
-- Projects never gets its own measurement store: the Project workroom calls the
-- same Roadmap service (Canon 17).
--
-- Why a table and not a column: a metric (P3-01) is one contract, while a
-- measurement is one reading of it on one day, and a milestone will have many
-- readings over time. Nothing here overwrites the metric contract; baseline and
-- target stay on roadmap_milestones.outcome_metric and are read, never written,
-- from a measurement.
--
-- Rows are append only evidence. There is no update policy and no delete
-- policy on purpose: a reading that was true on a day stays on record. A
-- correction law (supersession) is an open operability item, not something this
-- migration invents.

create table if not exists public.roadmap_measurements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  milestone_id uuid not null references public.roadmap_milestones(id) on delete cascade,
  -- Identity of the metric that was measured, not a copy of its contract.
  metric_key text not null,
  value numeric not null,
  -- The day the reading is true for, human entered, stored at noon UTC as the
  -- rest of the suite stores a calendar day. There is deliberately no default:
  -- a measurement must never silently become "now".
  measured_at timestamptz not null,
  -- Where the number was read from, in the person's own words.
  source text not null,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  -- Shared provenance shape (src/domain/activity.ts Provenance).
  provenance jsonb not null default '{}'::jsonb,
  -- Replay protection: the same reading submitted twice is one measurement.
  source_event_key text not null,
  constraint roadmap_measurements_source_not_blank check (length(btrim(source)) > 0),
  constraint roadmap_measurements_metric_key_not_blank check (length(btrim(metric_key)) > 0)
);

create unique index if not exists roadmap_measurements_replay_idx
  on public.roadmap_measurements (milestone_id, source_event_key);

create index if not exists roadmap_measurements_milestone_idx
  on public.roadmap_measurements (milestone_id, measured_at desc);

create index if not exists roadmap_measurements_roadmap_idx
  on public.roadmap_measurements (roadmap_id, measured_at desc);

grant select, insert on public.roadmap_measurements to authenticated;
grant all on public.roadmap_measurements to service_role;

alter table public.roadmap_measurements enable row level security;

drop policy if exists "Members read measurements" on public.roadmap_measurements;
create policy "Members read measurements"
  on public.roadmap_measurements for select to authenticated
  using (private.is_org_member(organization_id));

-- A measurement is written by the signed in person, as themselves. There is no
-- service role path for ordinary human recording.
drop policy if exists "Members record measurements" on public.roadmap_measurements;
create policy "Members record measurements"
  on public.roadmap_measurements for insert to authenticated
  with check (
    private.is_org_member(organization_id)
    and recorded_by = auth.uid()
  );

comment on table public.roadmap_measurements is
  'P3-02 outcome measurements. Append only human evidence against a milestone outcome metric. Roadmap owns this truth; no room keeps a second copy.';

-- Append only by construction: no update or delete policy exists, so a
-- recorded reading cannot be edited or removed by a member. A measurement is
-- historical evidence of what a person read on a day. Correcting a mistaken
-- reading is an open operability item (see roadmap.md); until a correction law
-- exists, the honest move is to record the true reading as a later row.
