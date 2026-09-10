-- Trust Tai OS. Roadmap Intelligence v2 schema
--
-- NOT YET APPLIED to the externally managed Trust Tai Supabase project
-- (ref okydosoacqdnursmmenf). Until it is applied, the Research, Strategy,
-- Milestones, Studio, Walkthrough and Build Order views surface the real
-- Postgrest error. They never fall back to demo data.
--
-- v2 extends v1. `roadmaps`, `roadmap_stages` and `roadmap_decisions` stay
-- exactly as they are. Companies stay in `clients` / `prospects`, people stay
-- in `contacts`, history stays in `activities`. Nothing here duplicates a
-- shared core entity.
--
-- Order per table: CREATE TABLE, GRANT, ENABLE RLS, POLICY.
-- Access is organization-scoped through the existing hardened helper
-- `private.is_org_member(uuid)`. v2 creates no SECURITY DEFINER helper.

-- --------------------------------------------------------- roadmap_research
-- One row per research pass. History is kept: a new pass inserts, it does not
-- overwrite, so "how did the roadmap change" stays answerable.

create table if not exists public.roadmap_research (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  status text not null default 'pending',
  company_model jsonb not null default '[]'::jsonb,
  buyers jsonb not null default '[]'::jsonb,
  strengths jsonb not null default '[]'::jsonb,
  digital_presence jsonb not null default '[]'::jsonb,
  competitors jsonb not null default '[]'::jsonb,
  market_direction jsonb not null default '[]'::jsonb,
  -- Every public claim carries {label, url, checked_at, provider, model}.
  sources jsonb not null default '[]'::jsonb,
  unknowns jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  checked_at timestamptz,
  error text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_research_latest_idx
  on public.roadmap_research (roadmap_id, created_at desc);

grant select, insert, update, delete on public.roadmap_research to authenticated;
grant all on public.roadmap_research to service_role;

alter table public.roadmap_research enable row level security;

create policy "Members read roadmap research"
  on public.roadmap_research for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap research"
  on public.roadmap_research for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap research"
  on public.roadmap_research for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap research"
  on public.roadmap_research for delete to authenticated
  using (private.is_org_member(organization_id));

-- -------------------------------------------------------- roadmap_strategies
-- One current strategy per roadmap. Each jsonb item carries its own tier,
-- confidence, sources and approval state; approval is only ever set by a person.

create table if not exists public.roadmap_strategies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  point_a jsonb not null default '[]'::jsonb,
  anchor_proof jsonb not null default '[]'::jsonb,
  horizon jsonb not null default '[]'::jsonb,
  point_b jsonb,
  point_c jsonb,
  central_truth jsonb,
  gaps jsonb not null default '[]'::jsonb,
  leverage_point jsonb,
  provider text,
  model text,
  generated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roadmap_strategies_roadmap_idx
  on public.roadmap_strategies (roadmap_id);

grant select, insert, update, delete on public.roadmap_strategies to authenticated;
grant all on public.roadmap_strategies to service_role;

alter table public.roadmap_strategies enable row level security;

create policy "Members read roadmap strategies"
  on public.roadmap_strategies for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap strategies"
  on public.roadmap_strategies for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap strategies"
  on public.roadmap_strategies for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap strategies"
  on public.roadmap_strategies for delete to authenticated
  using (private.is_org_member(organization_id));

-- -------------------------------------------------------- roadmap_milestones
-- Candidates are generated in bulk and pressure-tested. Only a human moves one
-- to approved, and only an approved + decided milestone enters Build Order.

create table if not exists public.roadmap_milestones (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  name text not null,
  what_we_build text not null default '',
  intended_user text not null default '',
  supporting_market_direction text not null default '',
  client_advantage text not null default '',
  current_gap text not null default '',
  evidence jsonb not null default '[]'::jsonb,
  immediate_value text not null default '',
  long_term_value text not null default '',
  dependencies jsonb not null default '[]'::jsonb,
  execution_boundary text not null default '',
  confidence text not null default 'low',
  priority_score integer not null default 0,
  priority_rationale jsonb not null default '[]'::jsonb,
  recommended_sequence integer not null default 0,
  status text not null default 'candidate',
  tier text not null default 'inferred',
  owner_user_id uuid references auth.users(id) on delete set null,
  owner_label text,
  decision_note text,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_milestones_board_idx
  on public.roadmap_milestones (roadmap_id, status, recommended_sequence);

grant select, insert, update, delete on public.roadmap_milestones to authenticated;
grant all on public.roadmap_milestones to service_role;

alter table public.roadmap_milestones enable row level security;

create policy "Members read roadmap milestones"
  on public.roadmap_milestones for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap milestones"
  on public.roadmap_milestones for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap milestones"
  on public.roadmap_milestones for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap milestones"
  on public.roadmap_milestones for delete to authenticated
  using (private.is_org_member(organization_id));

-- --------------------------------------------------------- roadmap_artifacts
-- Studio output. Structure only: an evidence-bound document skeleton, never a
-- promise of a delivered asset.

create table if not exists public.roadmap_artifacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  kind text not null default 'preview',
  title text not null default '',
  sections jsonb not null default '[]'::jsonb,
  accent text,
  logo_url text,
  generated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists roadmap_artifacts_kind_idx
  on public.roadmap_artifacts (roadmap_id, kind);

grant select, insert, update, delete on public.roadmap_artifacts to authenticated;
grant all on public.roadmap_artifacts to service_role;

alter table public.roadmap_artifacts enable row level security;

create policy "Members read roadmap artifacts"
  on public.roadmap_artifacts for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap artifacts"
  on public.roadmap_artifacts for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap artifacts"
  on public.roadmap_artifacts for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap artifacts"
  on public.roadmap_artifacts for delete to authenticated
  using (private.is_org_member(organization_id));

-- ---------------------------------------------------------- roadmap_sessions
-- Walkthrough. What was said in the room, captured as it happens.

create table if not exists public.roadmap_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  entries jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists roadmap_sessions_recent_idx
  on public.roadmap_sessions (roadmap_id, started_at desc);

grant select, insert, update, delete on public.roadmap_sessions to authenticated;
grant all on public.roadmap_sessions to service_role;

alter table public.roadmap_sessions enable row level security;

create policy "Members read roadmap sessions"
  on public.roadmap_sessions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap sessions"
  on public.roadmap_sessions for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members update roadmap sessions"
  on public.roadmap_sessions for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap sessions"
  on public.roadmap_sessions for delete to authenticated
  using (private.is_org_member(organization_id));

-- --------------------------------------------------------- roadmap_questions
-- Ask Roadmap. Every answer is stored with the evidence it cited.

create table if not exists public.roadmap_questions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  roadmap_id uuid not null references public.roadmaps(id) on delete cascade,
  question text not null,
  answer text not null default '',
  facts jsonb not null default '[]'::jsonb,
  inferences jsonb not null default '[]'::jsonb,
  unknowns jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists roadmap_questions_recent_idx
  on public.roadmap_questions (roadmap_id, created_at desc);

grant select, insert, update, delete on public.roadmap_questions to authenticated;
grant all on public.roadmap_questions to service_role;

alter table public.roadmap_questions enable row level security;

create policy "Members read roadmap questions"
  on public.roadmap_questions for select to authenticated
  using (private.is_org_member(organization_id));
create policy "Members write roadmap questions"
  on public.roadmap_questions for insert to authenticated
  with check (private.is_org_member(organization_id));
create policy "Members delete roadmap questions"
  on public.roadmap_questions for delete to authenticated
  using (private.is_org_member(organization_id));
