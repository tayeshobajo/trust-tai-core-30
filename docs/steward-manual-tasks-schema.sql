-- Trust Tai OS. Steward manual tasks.
--
-- A task a person creates directly in Steward, rather than one derived from a
-- meeting promise, a project work item, or a Paperclip agent. It projects into
-- the same accountability checklist as everything else.
--
-- Idempotent and additive. Mirrors
-- supabase/migrations/20260921160000_steward_manual_tasks.sql so the schema can
-- be applied by hand if needed. Assumes public.organizations and
-- private.is_org_member already exist.

create table if not exists public.steward_tasks (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  title text not null,
  client_id uuid,
  client_label text,
  project_id uuid,
  project_label text,
  due_at timestamptz,
  owner_user_id uuid,
  owner_label text,
  priority text not null default 'normal',
  assignee_kind text not null default 'human',
  ai_mode text,
  status text not null default 'open',
  subtasks jsonb not null default '[]'::jsonb,
  acceptance_criteria jsonb not null default '[]'::jsonb,
  context_links jsonb not null default '[]'::jsonb,
  notes text,
  paperclip_task_id text,
  correlation_id text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint steward_tasks_pkey primary key (id),
  constraint steward_tasks_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint steward_tasks_priority_check check (priority in ('low', 'normal', 'high', 'urgent')),
  constraint steward_tasks_assignee_kind_check check (assignee_kind in ('human', 'agent')),
  constraint steward_tasks_ai_mode_check check (
    (assignee_kind = 'agent' and ai_mode in ('safe_internal', 'routine_end_to_end'))
    or (assignee_kind <> 'agent' and ai_mode is null)
  ),
  constraint steward_tasks_status_check check (
    status in ('draft', 'open', 'in_progress', 'waiting', 'blocked', 'in_review', 'needs_approval', 'complete')
  )
);

create index if not exists steward_tasks_org_status_idx
  on public.steward_tasks (organization_id, status, created_at desc);
create index if not exists steward_tasks_org_owner_idx
  on public.steward_tasks (organization_id, owner_user_id);

alter table public.steward_tasks enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_tasks' and policyname = 'Members read steward task') then
    execute 'create policy "Members read steward task" on public.steward_tasks for select to authenticated using (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_tasks' and policyname = 'Members write steward task') then
    execute 'create policy "Members write steward task" on public.steward_tasks for insert to authenticated with check (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_tasks' and policyname = 'Members update steward task') then
    execute 'create policy "Members update steward task" on public.steward_tasks for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_tasks' and policyname = 'Members delete steward task') then
    execute 'create policy "Members delete steward task" on public.steward_tasks for delete to authenticated using (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_tasks' and policyname = 'steward_tasks_service_role') then
    execute 'create policy "steward_tasks_service_role" on public.steward_tasks for all using (auth.role() = ''service_role''::text)';
  end if;
end
$$;
