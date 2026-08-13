-- Trust Tai OS — Comms v1 schema
--
-- Apply this in the externally managed Trust Tai Supabase project
-- (ref okydosoacqdnursmmenf) via the SQL editor. This project does not own
-- that schema, so nothing here runs automatically.
--
-- Comms adds relationship state only. People stay in `contacts`, companies
-- stay in `clients` / `prospects`, history stays in `activities`. Nothing here
-- duplicates a shared core entity.
--
-- Order per table: CREATE TABLE, GRANT, ENABLE RLS, POLICY.
-- Access is organization-scoped through `organization_memberships`.

create or replace function public.is_org_member(_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.organization_memberships m
    where m.organization_id = _organization_id
      and m.user_id = auth.uid()
      and coalesce(m.status, 'active') = 'active'
  )
$$;

grant execute on function public.is_org_member(uuid) to authenticated;

-- ---------------------------------------------------------------- relationships

create table if not exists public.comms_relationships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  client_id uuid references public.clients(id) on delete set null,
  prospect_id uuid references public.prospects(id) on delete set null,
  full_name text not null,
  company_name text,
  email text,
  stage text not null default 'new',
  owner_user_id uuid references auth.users(id) on delete set null,
  source text not null default 'manual',
  met_at timestamptz,
  met_where text,
  last_touch_at timestamptz,
  next_action text,
  response_due_at timestamptz,
  follow_up_due_at timestamptz,
  observed jsonb not null default '[]'::jsonb,
  inferred jsonb not null default '[]'::jsonb,
  decided jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comms_relationships_org_idx
  on public.comms_relationships (organization_id, stage);
create unique index if not exists comms_relationships_prospect_idx
  on public.comms_relationships (organization_id, prospect_id)
  where prospect_id is not null;

grant select, insert, update, delete on public.comms_relationships to authenticated;
grant all on public.comms_relationships to service_role;

alter table public.comms_relationships enable row level security;

create policy "Members read relationships"
  on public.comms_relationships for select to authenticated
  using (public.is_org_member(organization_id));
create policy "Members write relationships"
  on public.comms_relationships for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy "Members update relationships"
  on public.comms_relationships for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "Members delete relationships"
  on public.comms_relationships for delete to authenticated
  using (public.is_org_member(organization_id));

-- --------------------------------------------------------------------- threads

create table if not exists public.comms_threads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_id uuid not null references public.comms_relationships(id) on delete cascade,
  channel text not null default 'email',
  subject text,
  state text not null default 'open',
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comms_threads_rel_idx
  on public.comms_threads (relationship_id);

grant select, insert, update, delete on public.comms_threads to authenticated;
grant all on public.comms_threads to service_role;

alter table public.comms_threads enable row level security;

create policy "Members read threads"
  on public.comms_threads for select to authenticated
  using (public.is_org_member(organization_id));
create policy "Members write threads"
  on public.comms_threads for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy "Members update threads"
  on public.comms_threads for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "Members delete threads"
  on public.comms_threads for delete to authenticated
  using (public.is_org_member(organization_id));

-- --------------------------------------------------------------------- touches

create table if not exists public.comms_touches (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_id uuid not null references public.comms_relationships(id) on delete cascade,
  thread_id uuid references public.comms_threads(id) on delete set null,
  channel text not null default 'email',
  direction text not null default 'outbound',
  occurred_at timestamptz not null default now(),
  summary text not null,
  body text,
  provenance jsonb not null default '{}'::jsonb,
  logged_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists comms_touches_rel_idx
  on public.comms_touches (relationship_id, occurred_at desc);

grant select, insert, update, delete on public.comms_touches to authenticated;
grant all on public.comms_touches to service_role;

alter table public.comms_touches enable row level security;

create policy "Members read touches"
  on public.comms_touches for select to authenticated
  using (public.is_org_member(organization_id));
create policy "Members write touches"
  on public.comms_touches for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy "Members update touches"
  on public.comms_touches for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "Members delete touches"
  on public.comms_touches for delete to authenticated
  using (public.is_org_member(organization_id));

-- ---------------------------------------------------------------------- drafts

create table if not exists public.comms_drafts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_id uuid not null references public.comms_relationships(id) on delete cascade,
  thread_id uuid references public.comms_threads(id) on delete set null,
  intent text not null default 'introduce',
  register text not null default 'warm_intro',
  subject text,
  body text not null,
  voice_version integer not null default 1,
  review_state text not null default 'draft',
  rationale jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comms_drafts_rel_idx
  on public.comms_drafts (relationship_id, created_at desc);

grant select, insert, update, delete on public.comms_drafts to authenticated;
grant all on public.comms_drafts to service_role;

alter table public.comms_drafts enable row level security;

create policy "Members read drafts"
  on public.comms_drafts for select to authenticated
  using (public.is_org_member(organization_id));
create policy "Members write drafts"
  on public.comms_drafts for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy "Members update drafts"
  on public.comms_drafts for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "Members delete drafts"
  on public.comms_drafts for delete to authenticated
  using (public.is_org_member(organization_id));

-- ------------------------------------------------------------------- reminders

create table if not exists public.comms_reminders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  relationship_id uuid not null references public.comms_relationships(id) on delete cascade,
  reason_code text not null,
  reason_text text not null,
  evidence jsonb not null default '[]'::jsonb,
  due_at timestamptz,
  state text not null default 'pending',
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists comms_reminders_rel_idx
  on public.comms_reminders (organization_id, state, due_at);

grant select, insert, update, delete on public.comms_reminders to authenticated;
grant all on public.comms_reminders to service_role;

alter table public.comms_reminders enable row level security;

create policy "Members read reminders"
  on public.comms_reminders for select to authenticated
  using (public.is_org_member(organization_id));
create policy "Members write reminders"
  on public.comms_reminders for insert to authenticated
  with check (public.is_org_member(organization_id));
create policy "Members update reminders"
  on public.comms_reminders for update to authenticated
  using (public.is_org_member(organization_id))
  with check (public.is_org_member(organization_id));
create policy "Members delete reminders"
  on public.comms_reminders for delete to authenticated
  using (public.is_org_member(organization_id));

-- -------------------------------------------------------------- voice profiles

create table if not exists public.comms_voice_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null default 'Voice DNA',
  content_markdown text not null default '',
  source_filename text,
  version integer not null default 1,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists comms_voice_profiles_org_idx
  on public.comms_voice_profiles (organization_id);

grant select, insert, update on public.comms_voice_profiles to authenticated;
grant all on public.comms_voice_profiles to service_role;

alter table public.comms_voice_profiles enable row level security;

create policy "Members read voice profile"
  on public.comms_voice_profiles for select to authenticated
  using (public.is_org_member(organization_id));

create policy "Admins write voice profile"
  on public.comms_voice_profiles for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = comms_voice_profiles.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and coalesce(m.status, 'active') = 'active'
    )
  );

create policy "Admins update voice profile"
  on public.comms_voice_profiles for update to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = comms_voice_profiles.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and coalesce(m.status, 'active') = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = comms_voice_profiles.organization_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and coalesce(m.status, 'active') = 'active'
    )
  );
