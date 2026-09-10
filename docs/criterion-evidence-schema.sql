-- Trust Tai OS: acceptance criterion evidence.
--
-- Additive, idempotent, RLS compatible. Nothing here changes the acceptance
-- criteria contract in docs/milestone-success-criteria-schema.sql, and nothing
-- here can complete a criterion or a milestone.
--
-- Product law (Acceptance Evidence Law): a checklist box records a human
-- judgment; evidence records why that judgment can be trusted. Evidence is
-- optional by default. It never auto-completes anything.
--
-- Files reuse the existing private `project-files` bucket and its org scoped
-- storage policies. Object paths are:
--   <organization_id>/criterion-evidence/<milestone_id>/<criterion_id>/<uuid>-<name>
-- No new bucket is created, and nothing is public.

create table if not exists public.roadmap_criterion_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null,
  milestone_id uuid not null references public.roadmap_milestones(id) on delete cascade,
  criterion_id uuid not null references public.roadmap_milestone_criteria(id) on delete cascade,
  type text not null,
  label text not null,
  url text,
  storage_path text,
  content_type text,
  size_bytes bigint,
  note text,
  created_by uuid not null,
  created_by_label text,
  created_at timestamptz not null default now(),
  source_event_key text,
  provenance jsonb,
  constraint roadmap_criterion_evidence_type_check
    check (type in ('file', 'link', 'note')),
  constraint roadmap_criterion_evidence_label_not_blank
    check (length(btrim(label)) > 0),
  -- Each type must actually carry the thing it claims to be.
  constraint roadmap_criterion_evidence_shape check (
    (type = 'link' and url is not null and length(btrim(url)) > 0)
    or (type = 'file' and storage_path is not null and length(btrim(storage_path)) > 0)
    or (type = 'note' and note is not null and length(btrim(note)) > 0)
  )
);

-- Replay safety: the same proof attached twice is one row.
create unique index if not exists roadmap_criterion_evidence_replay_idx
  on public.roadmap_criterion_evidence (criterion_id, source_event_key)
  where source_event_key is not null;

create index if not exists roadmap_criterion_evidence_criterion_idx
  on public.roadmap_criterion_evidence (criterion_id, created_at);

create index if not exists roadmap_criterion_evidence_roadmap_idx
  on public.roadmap_criterion_evidence (roadmap_id, created_at desc);

grant select, insert, delete on public.roadmap_criterion_evidence to authenticated;
grant all on public.roadmap_criterion_evidence to service_role;

alter table public.roadmap_criterion_evidence enable row level security;

drop policy if exists "criterion evidence readable by org members"
  on public.roadmap_criterion_evidence;
create policy "criterion evidence readable by org members"
  on public.roadmap_criterion_evidence
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "criterion evidence written by org members"
  on public.roadmap_criterion_evidence;
create policy "criterion evidence written by org members"
  on public.roadmap_criterion_evidence
  for insert
  to authenticated
  with check (private.is_org_member(organization_id) and created_by = auth.uid());

-- Evidence is corrected by removing and re-attaching, so there is no update
-- path: a stored proof is never quietly rewritten into a different proof.
drop policy if exists "criterion evidence removed by org members"
  on public.roadmap_criterion_evidence;
create policy "criterion evidence removed by org members"
  on public.roadmap_criterion_evidence
  for delete
  to authenticated
  using (private.is_org_member(organization_id));

comment on table public.roadmap_criterion_evidence is
  'Proof attached to one acceptance criterion: an uploaded file, a link, or a short note. Roadmap owned; optional by default; never completes a criterion or a milestone.';
