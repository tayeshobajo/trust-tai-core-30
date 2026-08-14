-- Trust Tai OS — Projects v1 (idempotent, additive).
--
-- Projects reuses the shared public.projects table. Nothing here renames or
-- drops anything. The app already writes tolerantly: any column below that is
-- missing is dropped from the write and the execution detail is kept in
-- metadata instead. Applying this migration simply makes the columns real, so
-- delivery can be queried directly in SQL.

alter table public.projects add column if not exists point_a text;
alter table public.projects add column if not exists point_b text;
alter table public.projects add column if not exists next_move text;
alter table public.projects add column if not exists owner_user_id uuid;
alter table public.projects add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.projects add column if not exists created_by uuid;

-- One project per approved roadmap milestone. The handoff is idempotent in the
-- app; this makes it idempotent in the database too.
create unique index if not exists projects_milestone_origin_idx
  on public.projects (organization_id, ((metadata -> 'origin' ->> 'milestoneId')))
  where (metadata -> 'origin' ->> 'milestoneId') is not null;

create index if not exists projects_metadata_gin_idx
  on public.projects using gin (metadata jsonb_path_ops);

-- Data API access. Projects is member-only: no anon grant.
grant select, insert, update, delete on public.projects to authenticated;
grant all on public.projects to service_role;

alter table public.projects enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'projects'
      and policyname = 'Members read their organization projects'
  ) then
    create policy "Members read their organization projects"
      on public.projects for select to authenticated
      using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = projects.organization_id
            and m.user_id = auth.uid()
            and coalesce(m.status, 'active') = 'active'
        )
      );
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'projects'
      and policyname = 'Members write their organization projects'
  ) then
    create policy "Members write their organization projects"
      on public.projects for all to authenticated
      using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = projects.organization_id
            and m.user_id = auth.uid()
            and coalesce(m.status, 'active') = 'active'
        )
      )
      with check (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = projects.organization_id
            and m.user_id = auth.uid()
            and coalesce(m.status, 'active') = 'active'
        )
      );
  end if;
end
$$;
