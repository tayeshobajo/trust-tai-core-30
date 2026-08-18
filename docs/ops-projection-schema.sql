-- Trust Tai OS — Ops project projection (idempotent, additive).
--
-- Ops remains the canonical owner of Ops truth. This table is a read-only
-- projection inside Trust Tai OS: Ops pushes one row per Ops project through
-- POST /api/public/ops/projects, and Core only ever reads it.
--
-- Nothing in Core writes this table with a user session. There are no
-- insert/update/delete policies for `authenticated` on purpose: the sync
-- endpoint writes with the service role after verifying the shared secret.

create table if not exists public.ops_project_projection (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  -- Ops' own primary key for the project. Stable across syncs.
  ops_project_id text not null,
  name text not null,
  company text,
  status text,
  health text not null default 'unknown'
    check (health in ('healthy', 'attention', 'incident', 'unknown')),
  owner text,
  environment text,
  -- Lineage to a canonical Core project, when Ops knows one.
  canonical_project_id uuid,
  -- Same-site Ops path for the deep link, e.g. "/projects/abc". Never a full
  -- URL, never another origin.
  ops_path text,
  -- Null means "Ops did not report this". It must never render as zero.
  open_issues integer,
  open_approvals integer,
  last_activity_at timestamptz,
  last_synced_at timestamptz not null default now(),
  archived boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ops_project_projection_key_idx
  on public.ops_project_projection (organization_id, ops_project_id);

create index if not exists ops_project_projection_org_idx
  on public.ops_project_projection (organization_id, archived, last_activity_at desc);

-- Data API access. Member-only read; no anon grant, no member writes.
grant select on public.ops_project_projection to authenticated;
grant all on public.ops_project_projection to service_role;

alter table public.ops_project_projection enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'ops_project_projection'
      and policyname = 'Members read their organization Ops projection'
  ) then
    create policy "Members read their organization Ops projection"
      on public.ops_project_projection for select to authenticated
      using (
        exists (
          select 1 from public.organization_memberships m
          where m.organization_id = ops_project_projection.organization_id
            and m.user_id = auth.uid()
            and coalesce(m.status, 'active') = 'active'
        )
      );
  end if;
end
$$;
