-- PROPOSED, NOT APPLIED. Owner: Codex, pending explicit Tai approval.
-- Scout people research for a qualified account.
--
-- Scout currently persists researched people inside the shared `contacts`
-- metadata, which carries the record but not the provenance this capability
-- needs (provider person id, why the person was selected, thought leadership,
-- verification timestamps). This table is the durable home for that.
--
-- No personal email, no phone number, no private data is stored here.

create table if not exists public.scout_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  full_name text not null,
  title text,
  company_name text not null,
  company_domain text,
  profile_url text,
  buying_role text not null default 'unknown'
    check (buying_role in ('owner', 'influencer', 'champion', 'unknown')),
  buying_role_evidence text,
  why_this_person text not null,
  work_email text,
  email_status text not null default 'not_checked'
    check (email_status in ('verified', 'found_unverified', 'not_found', 'not_checked')),
  provider text not null check (provider in ('apollo', 'clay', 'manual', 'other')),
  provider_person_id text,
  discovered_at timestamptz not null default now(),
  email_fetched_at timestamptz,
  email_verified_at timestamptz,
  thought_leadership_summary text,
  thought_leadership_source text,
  provenance jsonb not null default '{}'::jsonb,
  selected_for_outreach boolean not null default false,
  handoff_relationship_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists scout_people_provider_identity
  on public.scout_people (organization_id, prospect_id, provider, provider_person_id)
  where provider_person_id is not null;

create index if not exists scout_people_prospect
  on public.scout_people (organization_id, prospect_id);

revoke all on public.scout_people from public;
grant select, insert, update, delete on public.scout_people to authenticated;
grant all on public.scout_people to service_role;

alter table public.scout_people enable row level security;

create policy "members read scout people"
  on public.scout_people for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = scout_people.organization_id
        and m.user_id = auth.uid()
        and coalesce(m.status, 'active') = 'active'
    )
  );

create policy "members write scout people"
  on public.scout_people for insert to authenticated
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = scout_people.organization_id
        and m.user_id = auth.uid()
        and coalesce(m.status, 'active') = 'active'
    )
  );

create policy "members update scout people"
  on public.scout_people for update to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = scout_people.organization_id
        and m.user_id = auth.uid()
        and coalesce(m.status, 'active') = 'active'
    )
  );
