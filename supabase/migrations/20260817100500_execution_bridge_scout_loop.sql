-- Execution bridge contract for the Scout Growth Agent.
-- This codifies the live bridge schema so the repo becomes the source of truth.

create table if not exists public.execution_agents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  paperclip_agent_id text not null,
  name text not null,
  owning_app text not null,
  principal text not null,
  capabilities text[] not null default '{}'::text[],
  enabled boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists execution_agents_paperclip_idx
  on public.execution_agents (paperclip_agent_id);

create table if not exists public.execution_bindings (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  source_app text not null,
  source_entity_type text,
  source_entity_id uuid,
  conductor_action_id text references public.conductor_actions(id) on delete set null,
  paperclip_company_id text not null,
  paperclip_issue_id text,
  paperclip_agent_id text not null,
  paperclip_run_id text,
  objective text not null,
  expected_outcome text,
  status text not null default 'dispatched',
  result_summary text,
  business_outputs jsonb not null default '{}'::jsonb,
  idempotency_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists execution_bindings_agent_idx
  on public.execution_bindings (paperclip_agent_id, created_at desc);

create unique index if not exists execution_bindings_idempotency_idx
  on public.execution_bindings (idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_execution_bindings_status
  on public.execution_bindings (status);

drop index if exists public.idx_execution_bindings_agent;
drop index if exists public.idx_execution_bindings_idem;

alter table public.execution_agents enable row level security;
alter table public.execution_bindings enable row level security;

revoke all on public.execution_agents from anon, authenticated;
revoke all on public.execution_bindings from anon, authenticated;

grant select on public.execution_agents to authenticated;
grant select on public.execution_bindings to authenticated;

grant all on public.execution_agents to service_role;
grant all on public.execution_bindings to service_role;

drop policy if exists "Members read execution agents" on public.execution_agents;
create policy "Members read execution agents"
on public.execution_agents
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists service_role_full on public.execution_agents;
create policy service_role_full
on public.execution_agents
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

drop policy if exists "Members read execution bindings" on public.execution_bindings;
create policy "Members read execution bindings"
on public.execution_bindings
for select
to authenticated
using (private.is_org_member(organization_id));

drop policy if exists service_role_full on public.execution_bindings;
create policy service_role_full
on public.execution_bindings
for all
to public
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');

insert into public.execution_agents (
  organization_id,
  paperclip_agent_id,
  name,
  owning_app,
  principal,
  capabilities,
  enabled,
  metadata
)
select
  org.id,
  '092f5f88-b628-4a42-97d5-fb249f4d4905',
  'Scout Growth Agent',
  'scout',
  'agent:scout-growth',
  array[
    'scout.read',
    'scout.read_icp',
    'scout.discover',
    'scout.evaluate',
    'scout.create_prospect',
    'scout.attach_evidence'
  ]::text[],
  true,
  jsonb_build_object(
    'paperclip_company_id', 'aaa4eceb-44fb-4492-823c-65d3d90c5519',
    'paperclip_routine_id', '3ac1c38d',
    'paperclip_goal_id', 'd53ac251'
  )
from public.organizations as org
where org.slug = 'trust-tai'
on conflict (paperclip_agent_id) do update
set
  organization_id = excluded.organization_id,
  name = excluded.name,
  owning_app = excluded.owning_app,
  principal = excluded.principal,
  capabilities = excluded.capabilities,
  enabled = excluded.enabled,
  metadata = excluded.metadata,
  updated_at = now();
