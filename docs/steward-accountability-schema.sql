-- Trust Tai OS — Steward accountability state.
--
-- Idempotent and additive. It creates exactly one table, for the only
-- accountability concept Steward genuinely owns: how a task is framed and
-- ordered for a human, plus a completion record for meeting-only commitments
-- that have not been promoted into another owning app.
--
-- It deliberately does NOT store task titles, owners, due dates or statuses.
-- Those stay canonical:
--   * project delivery work  -> public.project_work_items
--   * meeting commitments    -> public.commitments
--   * agent execution state  -> Paperclip
--
-- Security. RLS on, policies reuse the existing hardened private.is_org_member.
-- anon keeps no privilege at all.

create extension if not exists "pgcrypto";

create table if not exists public.steward_task_state (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  -- Stable key produced by Steward: '<origin>:<id>', e.g. 'commitment:<uuid>'.
  task_key text not null,
  -- do_now | protect_time | delegate | deprioritize
  focus text,
  -- Human ordering within the checklist. Lower sorts first.
  rank integer,
  completed_by_label text,
  completed_at timestamptz,
  completion_note text,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint steward_task_state_focus_check
    check (focus is null or focus in ('do_now', 'protect_time', 'delegate', 'deprioritize'))
);

create unique index if not exists steward_task_state_org_key_idx
  on public.steward_task_state (organization_id, task_key);

create index if not exists steward_task_state_org_idx
  on public.steward_task_state (organization_id);

revoke all on public.steward_task_state from anon;
revoke all on public.steward_task_state from authenticated;
grant select, insert, update, delete on public.steward_task_state to authenticated;
grant all on public.steward_task_state to service_role;

alter table public.steward_task_state enable row level security;

drop policy if exists steward_task_state_select on public.steward_task_state;
create policy steward_task_state_select
  on public.steward_task_state
  for select
  to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists steward_task_state_insert on public.steward_task_state;
create policy steward_task_state_insert
  on public.steward_task_state
  for insert
  to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists steward_task_state_update on public.steward_task_state;
create policy steward_task_state_update
  on public.steward_task_state
  for update
  to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists steward_task_state_delete on public.steward_task_state;
create policy steward_task_state_delete
  on public.steward_task_state
  for delete
  to authenticated
  using (private.is_org_member(organization_id));
