-- Trust Tai OS — Roadmap Intelligence v2.1 (additive)
--
-- Studio became model backed. An artifact is now a composed client facing
-- document rather than a deterministic skeleton, so it has to carry the same
-- provenance discipline as research: which provider wrote it, which model,
-- what was refused during validation, and whether a person has since edited it.
--
-- The human edit flag is what stops regeneration from quietly overwriting a
-- document someone has already worked on. Nothing here changes existing rows'
-- behaviour, and every column is nullable or defaulted.
--
-- Apply to the Trust Tai Supabase project (okydosoacqdnursmmenf).

alter table public.roadmap_artifacts
  add column if not exists provider text,
  add column if not exists model text,
  -- Lines the validator refused because the approved packet did not back them.
  add column if not exists rejected jsonb not null default '[]'::jsonb,
  -- True once a person has edited the composed document by hand.
  add column if not exists human_edited boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null;

-- No new grants or policies are required: roadmap_artifacts already grants
-- select, insert, update and delete to authenticated, with row level security
-- scoped to organization membership through private.is_org_member.

-- Version history.
--
-- One row per kind stays the live document, so history needs its own table.
-- Every composition and every hand edit snapshots the version it replaced
-- before the live row changes. Nothing is overwritten silently and nothing is
-- versioned in local state.

alter table public.roadmap_artifacts
  add column if not exists version integer not null default 1;

create table if not exists public.roadmap_artifact_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  artifact_id uuid not null references public.roadmap_artifacts(id) on delete cascade,
  kind text not null,
  version integer not null,
  title text not null default '',
  sections jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  rejected jsonb not null default '[]'::jsonb,
  human_edited boolean not null default false,
  replaced_at timestamptz not null default now(),
  replaced_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists roadmap_artifact_versions_artifact_idx
  on public.roadmap_artifact_versions (artifact_id, version desc);

grant select, insert on public.roadmap_artifact_versions to authenticated;
grant all on public.roadmap_artifact_versions to service_role;

alter table public.roadmap_artifact_versions enable row level security;

create policy "Members read artifact versions"
  on public.roadmap_artifact_versions for select to authenticated
  using (private.is_org_member(organization_id));

create policy "Members write artifact versions"
  on public.roadmap_artifact_versions for insert to authenticated
  with check (private.is_org_member(organization_id));
