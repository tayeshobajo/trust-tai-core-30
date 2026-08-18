-- Trust Tai OS · intelligence audit trail
--
-- Append-only history of every change to project intelligence and agent
-- accountability: imports, confirmations, supersedes, asset/evidence updates,
-- and edits to what an agent is responsible for.
--
-- Append only is enforced in the database, not only in the app: members may
-- insert and read, nobody may update or delete. A history that can be tidied
-- up is not a history.
--
-- Apply to the Trust Tai Supabase project (okydosoacqdnursmmenf).

create table if not exists public.intelligence_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  project_id uuid references public.projects(id) on delete cascade,
  project_name text,
  agent_id text,
  action text not null,
  subject text not null,
  before_state text,
  after_state text,
  actor_id uuid not null,
  actor_label text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists intelligence_audit_org_idx
  on public.intelligence_audit (organization_id, occurred_at desc);
create index if not exists intelligence_audit_project_idx
  on public.intelligence_audit (project_id, occurred_at desc);
create index if not exists intelligence_audit_agent_idx
  on public.intelligence_audit (organization_id, agent_id, occurred_at desc);

grant select, insert on public.intelligence_audit to authenticated;
grant all on public.intelligence_audit to service_role;

alter table public.intelligence_audit enable row level security;

-- Read: active members of the organization only.
drop policy if exists intelligence_audit_read on public.intelligence_audit;
create policy intelligence_audit_read
  on public.intelligence_audit
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = intelligence_audit.organization_id
        and m.user_id = auth.uid()
        and coalesce(m.status, 'active') = 'active'
    )
  );

-- Write: only as yourself, only into your own organization.
drop policy if exists intelligence_audit_insert on public.intelligence_audit;
create policy intelligence_audit_insert
  on public.intelligence_audit
  for insert
  to authenticated
  with check (
    actor_id = auth.uid()
    and exists (
      select 1
      from public.organization_memberships m
      where m.organization_id = intelligence_audit.organization_id
        and m.user_id = auth.uid()
        and coalesce(m.status, 'active') = 'active'
    )
  );

-- No update policy and no delete policy exist on purpose. Append only.
