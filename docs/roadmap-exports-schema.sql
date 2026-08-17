-- Trust Tai OS — Roadmap client copies, execution links, and notes.
--
-- Apply to the shared backend (project okydosoacqdnursmmenf).
-- Idempotent: safe to run more than once.
--
-- Three concepts only:
--   roadmap_exports         a frozen, versioned client copy of an approved roadmap
--   roadmap_execution_links correlation between a milestone and the room executing it
--   roadmap_notes           short internal notes about a roadmap
--
-- Exports are snapshots. An existing version is never regenerated from current
-- roadmap state; a change produces a new version instead.

/* ------------------------------------------------------------------ exports */

create table if not exists public.roadmap_exports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  version text not null,
  status text not null default 'draft',
  snapshot jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  comms_relationship_id uuid,
  comms_message_id uuid,
  constraint roadmap_exports_status_check
    check (status in ('draft', 'ready', 'sent', 'superseded')),
  constraint roadmap_exports_version_unique unique (roadmap_id, version)
);

create index if not exists roadmap_exports_roadmap_idx
  on public.roadmap_exports (roadmap_id, created_at desc);

grant select, insert, update on public.roadmap_exports to authenticated;
grant all on public.roadmap_exports to service_role;

alter table public.roadmap_exports enable row level security;

drop policy if exists "roadmap_exports_read" on public.roadmap_exports;
create policy "roadmap_exports_read"
  on public.roadmap_exports for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "roadmap_exports_write" on public.roadmap_exports;
create policy "roadmap_exports_write"
  on public.roadmap_exports for insert to authenticated
  with check (private.is_org_member(organization_id));

-- Only delivery metadata may change after a copy exists; the snapshot is frozen
-- by convention in the application and by never granting delete here.
drop policy if exists "roadmap_exports_update" on public.roadmap_exports;
create policy "roadmap_exports_update"
  on public.roadmap_exports for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* --------------------------------------------------------- execution links */

create table if not exists public.roadmap_execution_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  milestone_id uuid not null,
  owning_app text not null,
  project_id uuid,
  ops_reference text,
  status text not null default 'requested',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_execution_links_app_check
    check (owning_app in ('projects', 'ops', 'studio')),
  constraint roadmap_execution_links_status_check
    check (status in ('requested', 'accepted', 'in_progress', 'complete', 'withdrawn')),
  constraint roadmap_execution_links_milestone_unique unique (milestone_id)
);

create index if not exists roadmap_execution_links_roadmap_idx
  on public.roadmap_execution_links (roadmap_id);

grant select, insert, update on public.roadmap_execution_links to authenticated;
grant all on public.roadmap_execution_links to service_role;

alter table public.roadmap_execution_links enable row level security;

drop policy if exists "roadmap_execution_links_read" on public.roadmap_execution_links;
create policy "roadmap_execution_links_read"
  on public.roadmap_execution_links for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "roadmap_execution_links_write" on public.roadmap_execution_links;
create policy "roadmap_execution_links_write"
  on public.roadmap_execution_links for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "roadmap_execution_links_update" on public.roadmap_execution_links;
create policy "roadmap_execution_links_update"
  on public.roadmap_execution_links for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* -------------------------------------------------------------------- notes */

create table if not exists public.roadmap_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  body text not null,
  author_user_id uuid,
  author_label text,
  created_at timestamptz not null default now()
);

create index if not exists roadmap_notes_roadmap_idx
  on public.roadmap_notes (roadmap_id, created_at desc);

grant select, insert, delete on public.roadmap_notes to authenticated;
grant all on public.roadmap_notes to service_role;

alter table public.roadmap_notes enable row level security;

drop policy if exists "roadmap_notes_read" on public.roadmap_notes;
create policy "roadmap_notes_read"
  on public.roadmap_notes for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "roadmap_notes_write" on public.roadmap_notes;
create policy "roadmap_notes_write"
  on public.roadmap_notes for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "roadmap_notes_delete" on public.roadmap_notes;
create policy "roadmap_notes_delete"
  on public.roadmap_notes for delete to authenticated
  using (private.is_org_member(organization_id) and author_user_id = auth.uid());

/* ---------------------------------------------------------------- evidence */

-- Anchor proof points a person linked by hand. Real references only: a label
-- plus, where it exists, the page it was read on. Nothing here is generated.

create table if not exists public.roadmap_evidence (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  milestone_id uuid,
  label text not null,
  url text,
  kind text not null default 'page',
  source_note text,
  observed_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint roadmap_evidence_kind_check
    check (kind in ('page', 'provider', 'human', 'computed'))
);

create index if not exists roadmap_evidence_roadmap_idx
  on public.roadmap_evidence (roadmap_id, created_at desc);

grant select, insert, update, delete on public.roadmap_evidence to authenticated;
grant all on public.roadmap_evidence to service_role;

alter table public.roadmap_evidence enable row level security;

drop policy if exists "roadmap_evidence_read" on public.roadmap_evidence;
create policy "roadmap_evidence_read"
  on public.roadmap_evidence for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "roadmap_evidence_write" on public.roadmap_evidence;
create policy "roadmap_evidence_write"
  on public.roadmap_evidence for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "roadmap_evidence_update" on public.roadmap_evidence;
create policy "roadmap_evidence_update"
  on public.roadmap_evidence for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists "roadmap_evidence_delete" on public.roadmap_evidence;
create policy "roadmap_evidence_delete"
  on public.roadmap_evidence for delete to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------------------------- decisions: plain labels */

-- Short human labels on an open decision ("pricing", "scope"). Optional, and
-- never a substitute for the question itself.
alter table public.roadmap_decisions
  add column if not exists labels text[] not null default '{}'::text[];

/* ----------------------------------------- exports: the Comms draft it made */

alter table public.roadmap_exports
  add column if not exists comms_draft_id uuid;
