-- Trust Tai OS — Roadmap artifact history (optional, additive)
--
-- Roadmap Intelligence works without this file. Studio already refuses to
-- overwrite a hand edited document, and every composition records its provider,
-- its model and the lines validation refused.
--
-- Apply this only if the room wants to read earlier versions of a client
-- document. Until it is applied, snapshots are skipped quietly and the live
-- document still saves.

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
