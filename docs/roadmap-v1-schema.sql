-- Trust Tai OS. Roadmap v1 schema
--
-- NOT YET APPLIED. Run this against the externally managed Trust Tai Supabase
-- project (ref okydosoacqdnursmmenf). Until it is applied, /modules/roadmap
-- shows a truthful "not ready" state; it never falls back to fixtures.
--
-- Roadmap adds sequencing state only. Companies stay in `clients` / `prospects`,
-- people stay in `contacts`, relationships stay in `comms_relationships`,
-- history stays in `activities`. Nothing here duplicates a shared core entity.
--
-- Order per table: CREATE TABLE, GRANT, ENABLE RLS, POLICY.
-- Access is organization-scoped through the existing hardened helper
-- `private.is_org_member(uuid)`. Roadmap creates no SECURITY DEFINER helper.

-- ------------------------------------------------------------------ roadmaps

create table if not exists public.roadmaps (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  relationship_id uuid references public.comms_relationships(id) on delete set null,
  title text not null,
  subject_label text not null,
  objective text not null,
  status text not null default 'draft',
  owner_user_id uuid references auth.users(id) on delete set null,
  -- Point A is observed truth only. Each entry carries its own evidence.
  point_a jsonb not null default '[]'::jsonb,
  -- Point B stays inferred until a person approves it.
  point_b jsonb,
  next_move jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmaps_org_idx on public.roadmaps (organization_id, status);
create unique index if not exists roadmaps_prospect_idx
  on public.roadmaps (organization_id, prospect_id) where prospect_id is not null;
create unique index if not exists roadmaps_relationship_idx
  on public.roadmaps (organization_id, relationship_id) where relationship_id is not null;

grant select, insert, update, delete on public.roadmaps to authenticated;
grant all on public.roadmaps to service_role;

alter table public.roadmaps enable row level security;

create policy "Members read roadmaps"
  on public.roadmaps for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmaps"
  on public.roadmaps for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmaps"
  on public.roadmaps for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmaps"
  on public.roadmaps for delete to authenticated
  using (private.is_org_member(organization_id));

-- ------------------------------------------------------------- roadmap_stages

create table if not exists public.roadmap_stages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  position integer not null default 0,
  title text not null,
  intent text,
  state text not null default 'mapped',
  tier text not null default 'inferred',
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_label text,
  evidence jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_stages_order_idx
  on public.roadmap_stages (roadmap_id, position);

grant select, insert, update, delete on public.roadmap_stages to authenticated;
grant all on public.roadmap_stages to service_role;

alter table public.roadmap_stages enable row level security;

create policy "Members read roadmap stages"
  on public.roadmap_stages for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap stages"
  on public.roadmap_stages for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap stages"
  on public.roadmap_stages for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap stages"
  on public.roadmap_stages for delete to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------- roadmap_decisions

create table if not exists public.roadmap_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  stage_id uuid references public.roadmap_stages(id) on delete set null,
  question text not null,
  why_it_matters text not null,
  options jsonb not null default '[]'::jsonb,
  recommendation text,
  recommendation_because text,
  evidence jsonb not null default '[]'::jsonb,
  owner_user_id uuid references auth.users(id) on delete set null,
  status text not null default 'open',
  resolution_note text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_decisions_open_idx
  on public.roadmap_decisions (organization_id, status, created_at desc);

grant select, insert, update, delete on public.roadmap_decisions to authenticated;
grant all on public.roadmap_decisions to service_role;

alter table public.roadmap_decisions enable row level security;

create policy "Members read roadmap decisions"
  on public.roadmap_decisions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap decisions"
  on public.roadmap_decisions for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap decisions"
  on public.roadmap_decisions for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap decisions"
  on public.roadmap_decisions for delete to authenticated
  using (private.is_org_member(organization_id));
