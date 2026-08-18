-- Trust Tai OS — Projects delivery room.
--
-- Apply to the shared backend (project okydosoacqdnursmmenf).
-- Idempotent: safe to run more than once.
--
-- Four concepts only, all owned by Projects and all pointing at the shared
-- `public.projects` row they belong to:
--
--   project_work_items  the delivery list for one project
--   project_blockers    what is stopping the work, and who owns clearing it
--   project_decisions   delivery decisions only; roadmap direction stays in Roadmap
--   project_files       real files, stored in the private `project-files` bucket
--
-- History still belongs to `public.activities`. Nothing here duplicates it.

/* -------------------------------------------------------------- work items */

create table if not exists public.project_work_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  title text not null,
  description text,
  status text not null default 'ready',
  owner_user_id uuid,
  owner_label text,
  due_date timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  sequence integer not null default 0,
  review_state text,
  depends_on uuid references public.project_work_items(id) on delete set null,
  milestone_id uuid,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_work_items_status_check
    check (status in ('ready', 'in_progress', 'in_review', 'blocked', 'complete'))
);

create index if not exists project_work_items_project_idx
  on public.project_work_items (project_id, sequence, created_at);

grant select, insert, update, delete on public.project_work_items to authenticated;
grant all on public.project_work_items to service_role;

alter table public.project_work_items enable row level security;

drop policy if exists "project_work_items_read" on public.project_work_items;
create policy "project_work_items_read"
  on public.project_work_items for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "project_work_items_insert" on public.project_work_items;
create policy "project_work_items_insert"
  on public.project_work_items for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "project_work_items_update" on public.project_work_items;
create policy "project_work_items_update"
  on public.project_work_items for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

drop policy if exists "project_work_items_delete" on public.project_work_items;
create policy "project_work_items_delete"
  on public.project_work_items for delete to authenticated
  using (private.is_org_member(organization_id));

/* ---------------------------------------------------------------- blockers */

create table if not exists public.project_blockers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_item_id uuid references public.project_work_items(id) on delete set null,
  reason text not null,
  impact text,
  owner_label text,
  next_move text,
  status text not null default 'open',
  raised_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolution text,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_blockers_status_check check (status in ('open', 'resolved'))
);

create index if not exists project_blockers_project_idx
  on public.project_blockers (project_id, status, raised_at desc);

grant select, insert, update on public.project_blockers to authenticated;
grant all on public.project_blockers to service_role;

alter table public.project_blockers enable row level security;

drop policy if exists "project_blockers_read" on public.project_blockers;
create policy "project_blockers_read"
  on public.project_blockers for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "project_blockers_insert" on public.project_blockers;
create policy "project_blockers_insert"
  on public.project_blockers for insert to authenticated
  with check (private.is_org_member(organization_id));

-- Resolved blockers stay in history; they are updated, never deleted.
drop policy if exists "project_blockers_update" on public.project_blockers;
create policy "project_blockers_update"
  on public.project_blockers for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* --------------------------------------------------------------- decisions */

create table if not exists public.project_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_item_id uuid references public.project_work_items(id) on delete set null,
  question text not null,
  why_it_matters text,
  owner_label text,
  status text not null default 'open',
  answer text,
  decided_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_decisions_status_check check (status in ('open', 'answered'))
);

create index if not exists project_decisions_project_idx
  on public.project_decisions (project_id, status, created_at desc);

grant select, insert, update on public.project_decisions to authenticated;
grant all on public.project_decisions to service_role;

alter table public.project_decisions enable row level security;

drop policy if exists "project_decisions_read" on public.project_decisions;
create policy "project_decisions_read"
  on public.project_decisions for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "project_decisions_insert" on public.project_decisions;
create policy "project_decisions_insert"
  on public.project_decisions for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "project_decisions_update" on public.project_decisions;
create policy "project_decisions_update"
  on public.project_decisions for update to authenticated
  using (private.is_org_member(organization_id))
  with check (private.is_org_member(organization_id));

/* ------------------------------------------------------------------- files */

create table if not exists public.project_files (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  project_id uuid not null references public.projects(id) on delete cascade,
  work_item_id uuid references public.project_work_items(id) on delete set null,
  name text not null,
  kind text not null default 'reference',
  storage_path text not null,
  content_type text,
  size_bytes bigint,
  uploaded_by uuid,
  uploaded_by_label text,
  created_at timestamptz not null default now(),
  constraint project_files_kind_check check (kind in ('working', 'deliverable', 'reference')),
  constraint project_files_path_unique unique (storage_path)
);

create index if not exists project_files_project_idx
  on public.project_files (project_id, kind, created_at desc);

grant select, insert, update, delete on public.project_files to authenticated;
grant all on public.project_files to service_role;

alter table public.project_files enable row level security;

drop policy if exists "project_files_read" on public.project_files;
create policy "project_files_read"
  on public.project_files for select to authenticated
  using (private.is_org_member(organization_id));

drop policy if exists "project_files_insert" on public.project_files;
create policy "project_files_insert"
  on public.project_files for insert to authenticated
  with check (private.is_org_member(organization_id));

drop policy if exists "project_files_delete" on public.project_files;
create policy "project_files_delete"
  on public.project_files for delete to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------------------------------------ file storage */

-- Private bucket. Every object path begins with the owning organization id:
--   <organization_id>/<project_id>/<uuid>-<file name>
insert into storage.buckets (id, name, public)
values ('project-files', 'project-files', false)
on conflict (id) do nothing;

drop policy if exists "project_files_object_read" on storage.objects;
create policy "project_files_object_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'project-files'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_object_insert" on storage.objects;
create policy "project_files_object_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'project-files'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "project_files_object_delete" on storage.objects;
create policy "project_files_object_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'project-files'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );
