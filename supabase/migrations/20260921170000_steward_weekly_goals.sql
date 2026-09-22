-- Trust Tai OS. Steward weekly goals.
--
-- A weekly goal is an outcome the Captain proposes and a person confirms. It
-- links a set of Steward tasks; progress is completed linked tasks over total
-- linked tasks, and the agent-cleared subset is counted separately so
-- "N cleared for you this week" is a true number, never invented.
--
-- The goal is inert until confirmed: a row lands as 'proposed' and only a
-- person confirming it flips it to 'confirmed'. This is the "Captain proposes,
-- person confirms" rule, at the data layer.
--
-- Fully idempotent and additive: safe to run against production (no-op) and
-- against a fresh database. Assumes public.organizations and
-- private.is_org_member already exist, as the rest of the migration chain does.

create table if not exists public.steward_weekly_goals (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  owner_user_id uuid,
  owner_label text,
  week_start date not null,
  title text not null,
  status text not null default 'proposed',
  linked_task_ids jsonb not null default '[]'::jsonb,
  target_count int,
  proposed_by text,
  confirmed_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint steward_weekly_goals_pkey primary key (id),
  constraint steward_weekly_goals_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint steward_weekly_goals_status_check check (
    status in ('proposed', 'confirmed', 'complete', 'archived')
  )
);

create index if not exists steward_weekly_goals_org_week_idx
  on public.steward_weekly_goals (organization_id, week_start desc);
create index if not exists steward_weekly_goals_org_owner_week_idx
  on public.steward_weekly_goals (organization_id, owner_user_id, week_start desc);

-- One active (proposed or confirmed) goal per person per week. Org-level rows
-- (owner_user_id null) are excluded, so several unassigned goals may coexist.
create unique index if not exists steward_weekly_goals_active_unique_idx
  on public.steward_weekly_goals (organization_id, owner_user_id, week_start)
  where status in ('proposed', 'confirmed') and owner_user_id is not null;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.steward_weekly_goals enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_weekly_goals' and policyname = 'Members read steward weekly goal') then
    execute 'create policy "Members read steward weekly goal" on public.steward_weekly_goals for select to authenticated using (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_weekly_goals' and policyname = 'Members write steward weekly goal') then
    execute 'create policy "Members write steward weekly goal" on public.steward_weekly_goals for insert to authenticated with check (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_weekly_goals' and policyname = 'Members update steward weekly goal') then
    execute 'create policy "Members update steward weekly goal" on public.steward_weekly_goals for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_weekly_goals' and policyname = 'Members delete steward weekly goal') then
    execute 'create policy "Members delete steward weekly goal" on public.steward_weekly_goals for delete to authenticated using (private.is_org_member(organization_id))';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'steward_weekly_goals' and policyname = 'steward_weekly_goals_service_role') then
    execute 'create policy "steward_weekly_goals_service_role" on public.steward_weekly_goals for all using (auth.role() = ''service_role''::text)';
  end if;
end
$$;
