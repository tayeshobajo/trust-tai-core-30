-- Trust Tai OS: milestone success definition and acceptance criteria.
--
-- Additive, idempotent, RLS compatible. Nothing here weakens the P3-01 outcome
-- metric contract or the P3-02 measurement table; both stay exactly as they
-- are, for the milestones that genuinely carry a number.
--
-- Product law: people describe success, the system structures measurement.

-- 1. The plain language success definition, written by a person.
--
--    {
--      "outcome": "Front facing pages redesigned and approved.",
--      "targetDate": "2026-09-30" | null,
--      "successCheck": "Client signs off in the review call." | null,
--      "tier": "decided",
--      "recordedBy": "<user uuid>",
--      "recordedAt": "<iso timestamp>"
--    }

alter table public.roadmap_milestones
  add column if not exists success_definition jsonb;

comment on column public.roadmap_milestones.success_definition is
  'Human facing milestone success: outcome sentence, optional target date, optional success check, plus decided-tier provenance. NULL means nobody has described success yet.';

alter table public.roadmap_milestones
  drop constraint if exists roadmap_milestones_success_definition_shape;

alter table public.roadmap_milestones
  add constraint roadmap_milestones_success_definition_shape check (
    success_definition is null
    or (
      jsonb_typeof(success_definition) = 'object'
      and coalesce(length(success_definition ->> 'outcome'), 0) > 0
    )
  );

-- 2. Acceptance criteria: the checklist that must be true before a milestone
--    can be called complete. Roadmap owned, ordered, with provenance on both
--    writing a condition and checking it off. Checking every box is evidence,
--    never an automatic completion.

create table if not exists public.roadmap_milestone_criteria (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null,
  milestone_id uuid not null references public.roadmap_milestones(id) on delete cascade,
  text text not null,
  position integer not null default 1,
  done boolean not null default false,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  completed_by uuid,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  source_event_key text,
  provenance jsonb,
  constraint roadmap_milestone_criteria_text_not_blank check (length(btrim(text)) > 0),
  constraint roadmap_milestone_criteria_done_provenance check (
    (done = false and completed_at is null and completed_by is null)
    or (done = true and completed_at is not null and completed_by is not null)
  )
);

create unique index if not exists roadmap_milestone_criteria_replay_idx
  on public.roadmap_milestone_criteria (milestone_id, source_event_key)
  where source_event_key is not null;

create index if not exists roadmap_milestone_criteria_milestone_idx
  on public.roadmap_milestone_criteria (milestone_id, position);

create index if not exists roadmap_milestone_criteria_roadmap_idx
  on public.roadmap_milestone_criteria (roadmap_id, position);

grant select, insert, update, delete on public.roadmap_milestone_criteria to authenticated;
grant all on public.roadmap_milestone_criteria to service_role;

alter table public.roadmap_milestone_criteria enable row level security;

drop policy if exists "criteria readable by org members" on public.roadmap_milestone_criteria;
create policy "criteria readable by org members"
  on public.roadmap_milestone_criteria
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "criteria written by org members" on public.roadmap_milestone_criteria;
create policy "criteria written by org members"
  on public.roadmap_milestone_criteria
  for insert
  to authenticated
  with check (private.is_org_member(organization_id) and created_by = auth.uid());

drop policy if exists "criteria updated by org members" on public.roadmap_milestone_criteria;
create policy "criteria updated by org members"
  on public.roadmap_milestone_criteria
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists "criteria removed by org members" on public.roadmap_milestone_criteria;
create policy "criteria removed by org members"
  on public.roadmap_milestone_criteria
  for delete
  to authenticated
  using (private.is_org_member(organization_id));

comment on table public.roadmap_milestone_criteria is
  'Milestone acceptance criteria: ordered, human written conditions that must be true before a milestone is completed. Roadmap owned; the Project workroom reads and writes these through the Roadmap service only.';
