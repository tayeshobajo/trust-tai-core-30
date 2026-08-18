-- Trust Tai OS — Project Intelligence (additive, idempotent).
--
-- Apply to the shared backend (project okydosoacqdnursmmenf).
--
-- Nothing here duplicates a canonical entity. Projects, clients, files,
-- decisions, work items, agents, memberships and activity history already
-- exist and are reused. These four tables add the layers a project needs to
-- be an intelligence environment rather than a task container:
--
--   project_thinking_sources  where the deeper thinking lives (link, not canon)
--   project_knowledge         distilled project truth with provenance + review
--   project_assets            metadata over existing public.project_files rows
--   project_connections       typed Lovable / GitHub / staging / production links
--   agent_effectiveness       what good looks like for an existing agent id
--
-- Every table follows the shared contract: GRANTs, RLS on, policies through
-- private.is_org_member. No anon access anywhere.

/* ------------------------------------------------------- thinking sources */

create table if not exists public.project_thinking_sources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_type text not null default 'other',
  title text not null,
  url text not null,
  is_primary boolean not null default false,
  -- Honest state only. 'connected'-style claims are not available here.
  sync_state text not null default 'link_saved',
  notes text,
  last_reviewed_at timestamptz,
  added_by uuid,
  added_by_label text,
  created_at timestamptz not null default now(),
  constraint project_thinking_sources_type_check
    check (source_type in ('chatgpt', 'claude', 'google_doc', 'notion', 'other')),
  constraint project_thinking_sources_sync_check
    check (sync_state in ('link_saved', 'import_available', 'import_needs_upload', 'imported', 'sync_unavailable'))
);

create index if not exists project_thinking_sources_project_idx
  on public.project_thinking_sources (project_id, is_primary desc, created_at desc);

grant select, insert, update, delete on public.project_thinking_sources to authenticated;
grant all on public.project_thinking_sources to service_role;
alter table public.project_thinking_sources enable row level security;

drop policy if exists "project_thinking_sources_read" on public.project_thinking_sources;
create policy "project_thinking_sources_read" on public.project_thinking_sources
  for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists "project_thinking_sources_insert" on public.project_thinking_sources;
create policy "project_thinking_sources_insert" on public.project_thinking_sources
  for insert to authenticated with check (private.is_org_member(organization_id));
drop policy if exists "project_thinking_sources_update" on public.project_thinking_sources;
create policy "project_thinking_sources_update" on public.project_thinking_sources
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
drop policy if exists "project_thinking_sources_delete" on public.project_thinking_sources;
create policy "project_thinking_sources_delete" on public.project_thinking_sources
  for delete to authenticated using (private.is_org_member(organization_id));

/* ------------------------------------------------------ project knowledge */

create table if not exists public.project_knowledge (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  section text not null,
  body text not null,
  origin text not null default 'human',
  review_state text not null default 'needs_review',
  source_reference text,
  source_label text,
  confidence numeric,
  captured_by uuid,
  captured_by_label text,
  captured_at timestamptz not null default now(),
  supersedes_id uuid references public.project_knowledge(id) on delete set null,
  constraint project_knowledge_section_check check (section in (
    'brief', 'objective', 'why', 'requirement', 'decision',
    'constraint', 'open_question', 'idea', 'meeting', 'reference'
  )),
  constraint project_knowledge_origin_check check (origin in (
    'human', 'roadmap', 'asset', 'meeting', 'thinking_room', 'agent'
  )),
  constraint project_knowledge_review_check check (review_state in (
    'detected', 'needs_review', 'confirmed', 'superseded'
  ))
);

create index if not exists project_knowledge_project_idx
  on public.project_knowledge (project_id, section, captured_at desc);

grant select, insert, update, delete on public.project_knowledge to authenticated;
grant all on public.project_knowledge to service_role;
alter table public.project_knowledge enable row level security;

drop policy if exists "project_knowledge_read" on public.project_knowledge;
create policy "project_knowledge_read" on public.project_knowledge
  for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists "project_knowledge_insert" on public.project_knowledge;
create policy "project_knowledge_insert" on public.project_knowledge
  for insert to authenticated with check (private.is_org_member(organization_id));
drop policy if exists "project_knowledge_update" on public.project_knowledge;
create policy "project_knowledge_update" on public.project_knowledge
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
drop policy if exists "project_knowledge_delete" on public.project_knowledge;
create policy "project_knowledge_delete" on public.project_knowledge
  for delete to authenticated using (private.is_org_member(organization_id));

/* ----------------------------------------------------------------- assets */
-- Metadata over an existing public.project_files row. One file system only.

create table if not exists public.project_assets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  file_id uuid not null references public.project_files(id) on delete cascade,
  asset_type text not null default 'other',
  title text not null,
  version integer not null default 1,
  -- Uploading is never approving.
  status text not null default 'draft',
  work_item_id uuid references public.project_work_items(id) on delete set null,
  decision_id uuid references public.project_decisions(id) on delete set null,
  uploaded_by uuid,
  uploaded_by_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_assets_type_check check (asset_type in (
    'mockup', 'screenshot', 'design_reference', 'document', 'brand_asset', 'other'
  )),
  constraint project_assets_status_check check (status in (
    'draft', 'reference', 'approved', 'superseded'
  )),
  constraint project_assets_file_unique unique (file_id)
);

create index if not exists project_assets_project_idx
  on public.project_assets (project_id, status, created_at desc);

grant select, insert, update, delete on public.project_assets to authenticated;
grant all on public.project_assets to service_role;
alter table public.project_assets enable row level security;

drop policy if exists "project_assets_read" on public.project_assets;
create policy "project_assets_read" on public.project_assets
  for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists "project_assets_insert" on public.project_assets;
create policy "project_assets_insert" on public.project_assets
  for insert to authenticated with check (private.is_org_member(organization_id));
drop policy if exists "project_assets_update" on public.project_assets;
create policy "project_assets_update" on public.project_assets
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
drop policy if exists "project_assets_delete" on public.project_assets;
create policy "project_assets_delete" on public.project_assets
  for delete to authenticated using (private.is_org_member(organization_id));

/* ------------------------------------------------------------ connections */

create table if not exists public.project_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  connection_type text not null,
  label text not null,
  url text,
  external_id text,
  -- 'linked' is a bookmark. 'connected' may only be written by a real reader,
  -- together with a genuine last_synced_at.
  status text not null default 'linked',
  last_synced_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint project_connections_type_check check (connection_type in (
    'lovable', 'github', 'staging', 'production', 'thinking', 'other'
  )),
  constraint project_connections_status_check check (status in (
    'linked', 'connected', 'needs_attention', 'unavailable'
  )),
  constraint project_connections_sync_honesty
    check (status <> 'connected' or last_synced_at is not null)
);

create index if not exists project_connections_project_idx
  on public.project_connections (project_id, connection_type);

grant select, insert, update, delete on public.project_connections to authenticated;
grant all on public.project_connections to service_role;
alter table public.project_connections enable row level security;

drop policy if exists "project_connections_read" on public.project_connections;
create policy "project_connections_read" on public.project_connections
  for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists "project_connections_insert" on public.project_connections;
create policy "project_connections_insert" on public.project_connections
  for insert to authenticated with check (private.is_org_member(organization_id));
drop policy if exists "project_connections_update" on public.project_connections;
create policy "project_connections_update" on public.project_connections
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
drop policy if exists "project_connections_delete" on public.project_connections;
create policy "project_connections_delete" on public.project_connections
  for delete to authenticated using (private.is_org_member(organization_id));

/* ------------------------------------------------------ agent effectiveness */
-- Agent identity stays in the existing execution agent model. This records
-- only what a person says good looks like for that agent id.

create table if not exists public.agent_effectiveness (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  agent_id text not null,
  responsibility text not null,
  expected_weekly_outcomes text[] not null default '{}',
  success_criteria text[] not null default '{}',
  surface_when text[] not null default '{}',
  required_context text[] not null default '{}',
  escalation_rules text[] not null default '{}',
  evidence_expected text[] not null default '{}',
  updated_by uuid,
  updated_at timestamptz not null default now(),
  constraint agent_effectiveness_unique unique (organization_id, agent_id)
);

grant select, insert, update, delete on public.agent_effectiveness to authenticated;
grant all on public.agent_effectiveness to service_role;
alter table public.agent_effectiveness enable row level security;

drop policy if exists "agent_effectiveness_read" on public.agent_effectiveness;
create policy "agent_effectiveness_read" on public.agent_effectiveness
  for select to authenticated using (private.is_org_member(organization_id));
drop policy if exists "agent_effectiveness_insert" on public.agent_effectiveness;
create policy "agent_effectiveness_insert" on public.agent_effectiveness
  for insert to authenticated with check (private.is_org_member(organization_id));
drop policy if exists "agent_effectiveness_update" on public.agent_effectiveness;
create policy "agent_effectiveness_update" on public.agent_effectiveness
  for update to authenticated using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
