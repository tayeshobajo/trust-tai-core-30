-- Activity targets ("Outcomes" settings backend).
--
-- Configuration only, one row per organization per activity stream. A target
-- says what a good cadence looks like; it never holds an actual. Actuals are
-- derived at read time, exactly as organization_weekly_targets works
-- (see src/domain/weekly-targets.ts).
--
-- The Scout weekly intro cap lives here under stream = 'scout_intros';
-- scout_intro_templates deliberately has no cap column.

create table if not exists public.organization_activity_targets (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  stream text not null,
  target_count integer not null,
  cadence text not null,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint organization_activity_targets_pkey primary key (id),
  constraint organization_activity_targets_organization_id_fkey
    foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint organization_activity_targets_updated_by_fkey
    foreign key (updated_by) references auth.users(id) on delete set null,
  constraint organization_activity_targets_stream_check
    check (stream in ('linkedin_connections', 'blog_posts', 'scout_intros')),
  constraint organization_activity_targets_target_count_check
    check (target_count >= 0),
  constraint organization_activity_targets_cadence_check
    check (cadence in ('day', 'week', 'month')),
  constraint organization_activity_targets_org_stream_key
    unique (organization_id, stream)
);

create index if not exists organization_activity_targets_org_idx
  on public.organization_activity_targets (organization_id);

alter table public.organization_activity_targets enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_activity_targets' and policyname = 'Members read activity targets') then
    create policy "Members read activity targets" on public.organization_activity_targets
      for select to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_activity_targets' and policyname = 'Members write activity targets') then
    create policy "Members write activity targets" on public.organization_activity_targets
      for insert to authenticated with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_activity_targets' and policyname = 'Members update activity targets') then
    create policy "Members update activity targets" on public.organization_activity_targets
      for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_activity_targets' and policyname = 'Members delete activity targets') then
    create policy "Members delete activity targets" on public.organization_activity_targets
      for delete to authenticated using (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'organization_activity_targets' and policyname = 'organization_activity_targets_service_role') then
    create policy "organization_activity_targets_service_role" on public.organization_activity_targets
      for all using (auth.role() = 'service_role'::text);
  end if;
end
$$;
