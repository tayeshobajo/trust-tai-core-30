-- APPLIED by Codex to the external Trust Tai OS database as
-- steward_agent_runs_and_source_links_hardened. ARCHIVE ONLY — never reapply.
-- Codex amendments: revoke all table privileges first; authenticated SELECT only;
-- service_role SELECT, INSERT, UPDATE only; SELECT policy requires requested_by = auth.uid().
-- Trust Tai OS: canonical task source identity and bounded internal-agent receipts.

alter table public.steward_tasks
  add column if not exists source_app text,
  add column if not exists source_entity_type text,
  add column if not exists source_entity_id uuid;

create unique index if not exists steward_tasks_org_correlation_unique
  on public.steward_tasks (organization_id, correlation_id)
  where correlation_id is not null;

create index if not exists steward_tasks_source_idx
  on public.steward_tasks (organization_id, source_app, source_entity_type, source_entity_id)
  where source_entity_id is not null;

create table if not exists public.steward_agent_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  task_id uuid not null references public.steward_tasks(id) on delete cascade,
  agent_id text not null,
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  status text not null,
  risk text not null,
  artifact text,
  evidence_refs jsonb not null default '[]'::jsonb,
  safe_error text,
  model text,
  provider_run_id text,
  started_at timestamptz not null default now(),
  settled_at timestamptz,
  created_at timestamptz not null default now(),
  constraint steward_agent_runs_status_check check (
    status in ('queued', 'working', 'needs_approval', 'blocked', 'completed', 'failed', 'cancelled')
  ),
  constraint steward_agent_runs_risk_check check (risk in ('low', 'high')),
  constraint steward_agent_runs_evidence_array check (jsonb_typeof(evidence_refs) = 'array'),
  constraint steward_agent_runs_org_idempotency_unique unique (organization_id, idempotency_key)
);

revoke all on public.steward_agent_runs from public, anon, authenticated, service_role;
grant select on public.steward_agent_runs to authenticated;
grant select, insert, update on public.steward_agent_runs to service_role;

alter table public.steward_agent_runs enable row level security;

create policy "Active members read bounded agent runs"
  on public.steward_agent_runs for select to authenticated
  using (
    requested_by = auth.uid()
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = steward_agent_runs.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

-- Browser roles cannot create or settle execution evidence. The authenticated
-- server entry point verifies the caller, then the service role writes the run.

create or replace function private.guard_steward_agent_run_identity()
returns trigger
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.task_id is distinct from old.task_id
    or new.agent_id is distinct from old.agent_id
    or new.requested_by is distinct from old.requested_by
    or new.idempotency_key is distinct from old.idempotency_key
    or new.risk is distinct from old.risk
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'steward_agent_runs immutable identity cannot change';
  end if;
  if not exists (
    select 1 from public.steward_tasks t
    where t.id = new.task_id and t.organization_id = new.organization_id
  ) then
    raise exception 'steward_agent_runs task belongs to another workspace';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_steward_agent_run_identity() from public, anon, authenticated;

drop trigger if exists steward_agent_runs_identity_guard on public.steward_agent_runs;
create trigger steward_agent_runs_identity_guard
  before insert or update on public.steward_agent_runs
  for each row execute function private.guard_steward_agent_run_identity();