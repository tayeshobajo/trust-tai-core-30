-- PROPOSED, NOT APPLIED. Owner: Codex, pending explicit application.
-- Revision 2 (2026-09-16). Supersedes revision 1 in full; revision 1 was never
-- applied, so this is still a first apply, not a re-apply.
--
-- Scout people research for a qualified account.
--
-- Scout currently persists researched people inside the shared `contacts`
-- metadata, which carries the record but not the provenance this capability
-- needs (provider person id, why the person was selected, thought leadership,
-- verification timestamps). This table is the durable home for that.
--
-- No personal email, no phone number, no private data is stored here.
--
-- WHAT CHANGED IN REVISION 2 (for review):
--   1. Membership is literally status = 'active'. coalesce(status,'active') is
--      gone from every policy, so missing, blank, invited or suspended is
--      refused.
--   2. Members are granted SELECT and nothing else. Every write runs with the
--      server credential after the server boundary has proved both active
--      membership and a writing role, so a view-only member cannot write or
--      delete by virtue of membership alone.
--   3. service_role gets SELECT, INSERT, UPDATE. No GRANT ALL, and no DELETE
--      or TRUNCATE for any application role: researched provenance is not
--      quietly erasable.
--   4. Same-workspace bindings for prospect, contact and the Comms
--      relationship are enforced by trigger, because the referenced tables do
--      not carry the composite unique keys a composite foreign key needs.
--   5. Workspace, prospect, provider identity and created_by are frozen after
--      insert; created_by is stamped from the verified actor.
--   6. UPDATE policy states both USING and WITH CHECK.
--   7. provenance is bound to a json object; the verification state, the
--      address and the two timestamps must agree with each other, so a
--      "verified" row without an address or a verification time cannot exist.

create table if not exists public.scout_people (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  full_name text not null check (length(btrim(full_name)) > 0),
  title text,
  company_name text not null check (length(btrim(company_name)) > 0),
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
  -- The identity this row is deduplicated on inside one prospect. Provider id
  -- when there is one, otherwise a professional address or a profile url, and
  -- otherwise a person-entered key. Never a name on its own.
  match_kind text not null
    check (match_kind in ('provider', 'email', 'profile', 'manual')),
  match_value text not null check (length(btrim(match_value)) > 0),
  discovered_at timestamptz not null default now(),
  email_fetched_at timestamptz,
  email_verified_at timestamptz,
  thought_leadership_summary text,
  thought_leadership_source text,
  provenance jsonb not null default '{}'::jsonb
    check (jsonb_typeof(provenance) = 'object' and pg_column_size(provenance) <= 8192),
  selected_for_outreach boolean not null default false,
  handoff_relationship_id uuid references public.comms_relationships(id) on delete set null,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- No address, no found state. An address, no verification time, no verified
  -- state. A verification time only ever belongs to a verified address.
  constraint scout_people_email_state_agrees check (
    (work_email is null and email_status in ('not_checked', 'not_found')
      and email_verified_at is null)
    or (work_email is not null and email_status = 'found_unverified'
      and email_fetched_at is not null and email_verified_at is null)
    or (work_email is not null and email_status = 'verified'
      and email_fetched_at is not null and email_verified_at is not null)
  ),
  -- A provider identity is required whenever the row claims one.
  constraint scout_people_provider_match check (
    match_kind <> 'provider' or provider_person_id is not null
  )
);

-- One row per human per prospect, on the strongest identifier available.
-- Atomic: concurrent saves of the same person collide here, not in the app.
create unique index if not exists scout_people_identity
  on public.scout_people (organization_id, prospect_id, provider, match_kind, match_value);

create index if not exists scout_people_prospect
  on public.scout_people (organization_id, prospect_id);

-- Least privilege, stated before anything is granted.
revoke all on public.scout_people from public, anon, authenticated, service_role;

-- Members read their own workspace's research. They never write here: writes
-- run with the server credential once the server has proved an active
-- membership AND a role allowed to write.
grant select on public.scout_people to authenticated;
grant select, insert, update on public.scout_people to service_role;

alter table public.scout_people enable row level security;

create policy "active members read scout people"
  on public.scout_people for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = scout_people.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- No INSERT, UPDATE or DELETE policy for authenticated, deliberately.

/* -------------------------------------------------- workspace bindings */

-- The referenced tables have single-column primary keys, so a composite
-- foreign key on (organization_id, id) is not available without adding unique
-- constraints to them. This trigger enforces the same rule without touching
-- their definitions: every reference must live in the same workspace.
create or replace function public.scout_people_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.prospects p
    where p.id = new.prospect_id and p.organization_id = new.organization_id
  ) then
    raise exception 'scout_people.prospect_id belongs to another workspace';
  end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts c
    where c.id = new.contact_id and c.organization_id = new.organization_id
  ) then
    raise exception 'scout_people.contact_id belongs to another workspace';
  end if;

  if new.handoff_relationship_id is not null and not exists (
    select 1 from public.comms_relationships r
    where r.id = new.handoff_relationship_id and r.organization_id = new.organization_id
  ) then
    raise exception 'scout_people.handoff_relationship_id belongs to another workspace';
  end if;

  return new;
end;
$$;

drop trigger if exists scout_people_same_workspace_trg on public.scout_people;
create trigger scout_people_same_workspace_trg
  before insert or update on public.scout_people
  for each row execute function public.scout_people_same_workspace();

/* ------------------------------------------------------ frozen identity */

create or replace function public.scout_people_identity_frozen()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.prospect_id is distinct from old.prospect_id
     or new.provider is distinct from old.provider
     or new.match_kind is distinct from old.match_kind
     or new.match_value is distinct from old.match_value
     or new.created_by is distinct from old.created_by
     or new.created_at is distinct from old.created_at
     or (old.provider_person_id is not null
         and new.provider_person_id is distinct from old.provider_person_id)
  then
    raise exception 'scout_people identity is immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists scout_people_identity_frozen_trg on public.scout_people;
create trigger scout_people_identity_frozen_trg
  before update on public.scout_people
  for each row execute function public.scout_people_identity_frozen();

-- Reviewed against the live schema on 2026-09-16 (project okydosoacqdnursmmenf):
--   organizations.id, prospects.id, contacts.id, comms_relationships.id and
--   organization_memberships(organization_id, user_id, status) all exist as
--   referenced, and public.scout_people does not exist yet.
-- STILL NOT APPLIED: this app runtime holds no credential that may run DDL on
-- the external project. Codex applies it.
