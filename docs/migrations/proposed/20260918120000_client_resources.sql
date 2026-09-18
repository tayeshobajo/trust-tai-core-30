-- APPLIED 2026-09-18 to project okydosoacqdnursmmenf by Codex.
-- DO NOT RE-APPLY. This file is the record of exactly what was applied.
--
-- Applied from the proposal at 5d6c6de with two amendments, both included
-- below verbatim:
--   1. The unique index keys on btrim(url), not lower(btrim(url)), so a path,
--      query token or document id keeps its case. /DocA and /doca are two
--      different addresses.
--   2. EXECUTE on both trigger functions is revoked from public, anon and
--      authenticated, so neither can be called outside the trigger.
-- Everything else is unchanged from the reviewed proposal.
--
-- Reviewed against the live schema of project okydosoacqdnursmmenf on
-- 2026-09-18: public.organizations, public.clients, public.projects and
-- public.organization_memberships all exist with the columns referenced here;
-- public.client_resources did not exist, so this was a first creation.
--
-- Files & Links on a client page.
--
-- Why an additive table rather than an existing one: project_connections and
-- project_thinking_sources both require a project_id, and both are owned by
-- one project. A client needs repeatable references that belong to the company
-- itself (a knowledge base, an account-wide chat, an assets folder) without
-- inventing a fake project to hold them. Project-scoped references stay
-- readable from their owning stores and are still shown once on the client
-- page; nothing here copies them.
--
-- This table stores metadata only: a title, an address, a category, an
-- optional description and an optional meeting date. No file contents, no
-- provider credential, no fetched material.

create table if not exists public.client_resources (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.clients(id) on delete cascade,
  -- NULL means the whole company. It never means "unknown project".
  project_id uuid references public.projects(id) on delete cascade,
  category text not null check (category in (
    'lovable_project', 'knowledge_base', 'chat', 'meeting_recording',
    'google_doc', 'assets', 'other'
  )),
  title text not null check (length(btrim(title)) > 0 and length(title) <= 200),
  url text not null check (
    length(url) <= 2048
    and (url ~* '^https?://')
    -- No embedded credential, ever.
    and url !~ '^[a-zA-Z]+://[^/@]*@'
  ),
  description text check (length(description) <= 2000),
  meeting_date date,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One exact address per scope. The same address on a different project, or
-- once company-wide and once on a project, is a deliberate act and allowed.
-- Keyed on btrim(url) only: case matters in a path, a query token and a
-- document id, so /DocA and /doca are two different addresses.
create unique index if not exists client_resources_scope_url
  on public.client_resources (
    organization_id,
    client_id,
    coalesce(project_id, '00000000-0000-0000-0000-000000000000'::uuid),
    btrim(url)
  );

create index if not exists client_resources_client
  on public.client_resources (organization_id, client_id, created_at desc);

create index if not exists client_resources_project
  on public.client_resources (organization_id, project_id);

-- Same-workspace and same-client bindings. The referenced tables do not carry
-- the composite unique keys a composite foreign key would need, so a trigger
-- proves it: the client belongs to this workspace, and the project (when one
-- is named) belongs to this workspace AND to this client.
create or replace function public.client_resources_same_workspace()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.clients c
    where c.id = new.client_id and c.organization_id = new.organization_id
  ) then
    raise exception 'client % is not in workspace %', new.client_id, new.organization_id;
  end if;

  if new.project_id is not null then
    if not exists (
      select 1 from public.projects p
      where p.id = new.project_id
        and p.organization_id = new.organization_id
        and p.client_id = new.client_id
    ) then
      raise exception 'project % does not belong to client % in workspace %',
        new.project_id, new.client_id, new.organization_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists client_resources_same_workspace on public.client_resources;
create trigger client_resources_same_workspace
  before insert or update on public.client_resources
  for each row execute function public.client_resources_same_workspace();

-- Workspace, client and author are frozen after insert. A resource can be
-- retitled, recategorised, re-pointed or moved between this client's own
-- projects; it can never change company or author.
create or replace function public.client_resources_frozen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.organization_id <> old.organization_id
     or new.client_id <> old.client_id
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at then
    raise exception 'workspace, client, author and creation time are frozen';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists client_resources_frozen on public.client_resources;
create trigger client_resources_frozen
  before update on public.client_resources
  for each row execute function public.client_resources_frozen();

-- Least privilege, stated before anything is granted.
revoke all on public.client_resources from public, anon, authenticated, service_role;

-- Members read their own workspace's links. They never write here directly:
-- writes run with the server credential once the server route has proved an
-- active membership AND a role allowed to write, because the database cannot
-- tell a view-only grant from a working one.
grant select on public.client_resources to authenticated;
grant select, insert, update, delete on public.client_resources to service_role;

alter table public.client_resources enable row level security;

create policy "active members read client resources"
  on public.client_resources for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = client_resources.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Note on DELETE: removing a resource removes the reference only. No external
-- document, recording or folder is touched, and no project file is affected.

-- The trigger functions are called by the triggers and by nothing else.
revoke all on function public.client_resources_same_workspace() from public, anon, authenticated;
revoke all on function public.client_resources_frozen() from public, anon, authenticated;
