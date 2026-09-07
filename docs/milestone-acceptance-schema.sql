-- Trust Tai OS: milestone delivery acceptance.
--
-- Additive, idempotent, RLS compatible. No new table, no new status, no
-- backfill: every existing milestone stays unaccepted until a person accepts
-- it explicitly.
--
-- Product law (Canon 24): roadmap approval and delivery acceptance are
-- different facts. `status = approved` at `tier = decided` means the milestone
-- was selected into the roadmap. Complete is derived from accepted_at alone.
--
-- Apply to the Trust Tai Supabase project (okydosoacqdnursmmenf).

alter table public.roadmap_milestones
  add column if not exists accepted_at timestamptz,
  add column if not exists accepted_by uuid references auth.users(id) on delete set null,
  add column if not exists accepted_by_label text,
  add column if not exists acceptance_note text;

comment on column public.roadmap_milestones.accepted_at is
  'When a person accepted the delivered work. NULL means not accepted. This, and only this, means complete.';
comment on column public.roadmap_milestones.accepted_by is
  'The person who accepted the delivered work.';
comment on column public.roadmap_milestones.accepted_by_label is
  'That person as displayed at the moment of acceptance.';
comment on column public.roadmap_milestones.acceptance_note is
  'Optional words from the accepting person. Never generated.';

-- Acceptance is one fact: a time and a person, together or not at all. A
-- reopened milestone clears both, so a note can never outlive the acceptance
-- it described.
alter table public.roadmap_milestones
  drop constraint if exists roadmap_milestones_acceptance_shape;

alter table public.roadmap_milestones
  add constraint roadmap_milestones_acceptance_shape check (
    (accepted_at is null and accepted_by is null and acceptance_note is null
      and accepted_by_label is null)
    or (accepted_at is not null and accepted_by is not null)
  );

-- No new grants or policies: roadmap_milestones already grants select, insert,
-- update and delete to authenticated, with row level security scoped to
-- organization membership.
