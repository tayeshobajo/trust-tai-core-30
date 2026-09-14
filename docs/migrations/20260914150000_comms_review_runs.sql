-- ---------------------------------------------------------------------------
-- Comms review, slice 2: review sessions, immutable draft versions, sources,
-- AI review runs, findings, semantic obligations, and version-bound approvals.
--
-- Version: 20260914150000_comms_review_runs
-- Target:  the existing external Supabase project okydosoacqdnursmmenf.
-- Applied by: Codex, with direct Supabase access. Lovable does not hold write
-- credentials for this project and provisions no new backend.
--
-- This migration ONLY ADDS. It never drops, rewrites, or backfills
-- comms_relationships, comms_threads, comms_messages or comms_drafts.
--
-- Assumes, as the rest of the chain does:
--   * public.organizations, public.organization_memberships
--   * public.comms_relationships, public.comms_threads
--   * private.is_org_member(uuid), private.is_org_admin(uuid)
--     (defined in docs/settings-schema.sql)
--
-- Authority model, enforced by the database and not only by the app:
--   * every row is organization-scoped, and every child row is tied to its
--     parent through a COMPOSITE foreign key on (id, organization_id), so a
--     member cannot staple a version, run, finding or approval belonging to
--     one workspace onto a session belonging to another,
--   * versions, sources, obligations and approvals are append-only for
--     ordinary members: no UPDATE or DELETE grant, no UPDATE or DELETE policy,
--   * the two legitimate mutations (a run finishing, a finding being decided)
--     are allowed narrowly and policed by triggers that reject any change to
--     the immutable columns,
--   * an approval may only be inserted by an owner or admin
--     (private.is_org_admin), it always names the approver and the exact draft
--     version and context fingerprint it covers, and it can never be edited
--     or deleted afterwards. Staleness is decided by reading, never by
--     rewriting history.
--
-- No broad SECURITY DEFINER function is introduced. The trigger functions run
-- with the caller's rights and only narrow what is already permitted.
--
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

-- ------------------------------------------------------------- 1. sessions

create table if not exists public.comms_review_sessions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  relationship_id uuid,
  thread_id uuid,
  title text not null default 'Review',
  /* The human-editable read of the situation. A correction here outranks
     anything the model inferred on a later run. */
  situation text,
  goal text,
  recipient_name text,
  recipient_email text,
  status text not null default 'open',
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_review_sessions_pkey primary key (id),
  constraint comms_review_sessions_org_key unique (id, organization_id),
  constraint comms_review_sessions_status_chk check (status in ('open', 'approved', 'closed')),
  constraint comms_review_sessions_org_fkey foreign key (organization_id)
    references public.organizations(id) on delete cascade,
  constraint comms_review_sessions_relationship_fkey foreign key (relationship_id)
    references public.comms_relationships(id) on delete set null,
  constraint comms_review_sessions_thread_fkey foreign key (thread_id)
    references public.comms_threads(id) on delete set null,
  constraint comms_review_sessions_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null
);

create index if not exists comms_review_sessions_org_idx
  on public.comms_review_sessions (organization_id, updated_at desc);

-- ------------------------------------------------------- 2. draft versions

create table if not exists public.comms_review_versions (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  version integer not null,
  subject text,
  body text not null,
  /* Where this exact text came from: the original intake, a human edit, or a
     revision built by accepting findings. The original is never overwritten. */
  origin text not null default 'intake',
  author_user_id uuid,
  created_at timestamptz not null default now(),
  constraint comms_review_versions_pkey primary key (id),
  constraint comms_review_versions_org_key unique (id, organization_id),
  constraint comms_review_versions_seq_key unique (session_id, version),
  constraint comms_review_versions_origin_chk check (origin in ('intake', 'edit', 'revision')),
  constraint comms_review_versions_version_chk check (version >= 1),
  constraint comms_review_versions_session_fkey foreign key (session_id, organization_id)
    references public.comms_review_sessions(id, organization_id) on delete cascade,
  constraint comms_review_versions_author_fkey foreign key (author_user_id)
    references auth.users(id) on delete set null
);

create index if not exists comms_review_versions_session_idx
  on public.comms_review_versions (session_id, version desc);

-- -------------------------------------------------------------- 3. sources

create table if not exists public.comms_review_sources (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  label text not null default 'Pasted conversation',
  kind text not null default 'pasted_text',
  filename text,
  media_type text,
  /* Honest per-source status. Only 'parsed' rows carry content, and only
     'parsed' rows may be treated as read. */
  status text not null default 'parsed',
  status_note text,
  content text,
  char_count integer not null default 0,
  /* Stable content hash: the idempotency key that stops a double upload from
     becoming two sources. */
  checksum text not null,
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint comms_review_sources_pkey primary key (id),
  constraint comms_review_sources_org_key unique (id, organization_id),
  constraint comms_review_sources_dedupe_key unique (session_id, checksum),
  constraint comms_review_sources_kind_chk
    check (kind in ('pasted_text', 'text_file', 'markdown_file', 'other_file')),
  constraint comms_review_sources_status_chk
    check (status in ('parsed', 'unsupported', 'unreadable', 'empty')),
  constraint comms_review_sources_session_fkey foreign key (session_id, organization_id)
    references public.comms_review_sessions(id, organization_id) on delete cascade,
  constraint comms_review_sources_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null
);

create index if not exists comms_review_sources_session_idx
  on public.comms_review_sources (session_id, created_at);

-- ----------------------------------------------------------------- 4. runs

create table if not exists public.comms_review_runs (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  /* A run always reviews exactly one immutable version. A newer version can
     never be judged by an older run. */
  version_id uuid not null,
  status text not null default 'running',
  /* Evaluation evidence, recorded per run (C22). */
  provider text,
  model text,
  prompt_version text,
  context_fingerprint text,
  stages jsonb not null default '[]'::jsonb,
  latency_ms integer,
  error_code text,
  /* The read itself. */
  summary text,
  goal_read text,
  coverage jsonb not null default '{}'::jsonb,
  limitations jsonb not null default '[]'::jsonb,
  source_manifest jsonb not null default '[]'::jsonb,
  created_by uuid,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint comms_review_runs_pkey primary key (id),
  constraint comms_review_runs_org_key unique (id, organization_id),
  constraint comms_review_runs_status_chk check (status in ('running', 'complete', 'failed')),
  constraint comms_review_runs_session_fkey foreign key (session_id, organization_id)
    references public.comms_review_sessions(id, organization_id) on delete cascade,
  constraint comms_review_runs_version_fkey foreign key (version_id, organization_id)
    references public.comms_review_versions(id, organization_id) on delete cascade,
  constraint comms_review_runs_created_by_fkey foreign key (created_by)
    references auth.users(id) on delete set null
);

create index if not exists comms_review_runs_session_idx
  on public.comms_review_runs (session_id, started_at desc);
create index if not exists comms_review_runs_version_idx
  on public.comms_review_runs (version_id, started_at desc);

-- ------------------------------------------------------------- 5. findings

create table if not exists public.comms_review_findings (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  /* Anchored to the exact version the run read, so accepting a change can
     never land on newer words the reviewer has not seen. */
  version_id uuid not null,
  kind text not null default 'clarity',
  severity text not null default 'consider',
  excerpt text,
  excerpt_start integer,
  excerpt_end integer,
  why text not null,
  suggestion text,
  state text not null default 'open',
  decided_by uuid,
  decided_at timestamptz,
  decision_note text,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  constraint comms_review_findings_pkey primary key (id),
  constraint comms_review_findings_org_key unique (id, organization_id),
  constraint comms_review_findings_state_chk check (state in ('open', 'accepted', 'kept', 'edited')),
  constraint comms_review_findings_severity_chk check (severity in ('must_fix', 'consider', 'note')),
  constraint comms_review_findings_run_fkey foreign key (run_id, organization_id)
    references public.comms_review_runs(id, organization_id) on delete cascade,
  constraint comms_review_findings_version_fkey foreign key (version_id, organization_id)
    references public.comms_review_versions(id, organization_id) on delete cascade,
  constraint comms_review_findings_decided_by_fkey foreign key (decided_by)
    references auth.users(id) on delete set null
);

create index if not exists comms_review_findings_run_idx
  on public.comms_review_findings (run_id, position);

-- ---------------------------------------------------------- 6. obligations

create table if not exists public.comms_review_obligations (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  run_id uuid not null,
  source_id uuid,
  kind text not null default 'question',
  /* The obligation as it appears in the source, with its anchor. */
  excerpt text not null,
  source_start integer,
  source_end integer,
  status text not null default 'uncertain',
  /* How the status was reached. 'lexical_candidate' is a heuristic hint only
     and is never sufficient evidence of an answer. */
  method text not null default 'semantic',
  confidence text not null default 'low',
  answer_excerpt text,
  answer_start integer,
  answer_end integer,
  because text,
  created_at timestamptz not null default now(),
  constraint comms_review_obligations_pkey primary key (id),
  constraint comms_review_obligations_org_key unique (id, organization_id),
  constraint comms_review_obligations_kind_chk check (kind in ('question', 'request')),
  constraint comms_review_obligations_status_chk
    check (status in ('answered', 'partly_answered', 'pending_confirmation', 'missing', 'uncertain')),
  constraint comms_review_obligations_method_chk check (method in ('semantic', 'lexical_candidate')),
  constraint comms_review_obligations_confidence_chk check (confidence in ('high', 'medium', 'low')),
  constraint comms_review_obligations_run_fkey foreign key (run_id, organization_id)
    references public.comms_review_runs(id, organization_id) on delete cascade,
  constraint comms_review_obligations_source_fkey foreign key (source_id, organization_id)
    references public.comms_review_sources(id, organization_id) on delete set null
);

create index if not exists comms_review_obligations_run_idx
  on public.comms_review_obligations (run_id, created_at);

-- ------------------------------------------------------------ 7. approvals

create table if not exists public.comms_review_approvals (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  session_id uuid not null,
  /* Exactly what was approved: this version's words, under this context. */
  version_id uuid not null,
  run_id uuid,
  context_fingerprint text not null,
  approved_by uuid not null,
  approved_at timestamptz not null default now(),
  approver_role text,
  reason text,
  constraint comms_review_approvals_pkey primary key (id),
  constraint comms_review_approvals_org_key unique (id, organization_id),
  constraint comms_review_approvals_session_fkey foreign key (session_id, organization_id)
    references public.comms_review_sessions(id, organization_id) on delete cascade,
  constraint comms_review_approvals_version_fkey foreign key (version_id, organization_id)
    references public.comms_review_versions(id, organization_id) on delete cascade,
  constraint comms_review_approvals_run_fkey foreign key (run_id, organization_id)
    references public.comms_review_runs(id, organization_id) on delete set null,
  constraint comms_review_approvals_approved_by_fkey foreign key (approved_by)
    references auth.users(id) on delete restrict
);

create index if not exists comms_review_approvals_session_idx
  on public.comms_review_approvals (session_id, approved_at desc);

-- ---------------------------------------------------------------------------
-- Triggers: the narrow mutations, policed
-- ---------------------------------------------------------------------------

-- An approval always names the person who actually made the request.
create or replace function public.comms_review_approval_guard()
returns trigger
language plpgsql
as $$
begin
  if new.approved_by is distinct from auth.uid() and auth.role() <> 'service_role' then
    raise exception 'An approval must be recorded by the person making it.';
  end if;
  if coalesce(btrim(new.context_fingerprint), '') = '' then
    raise exception 'An approval must record the exact context it covers.';
  end if;
  new.approved_at := now();
  return new;
end;
$$;

drop trigger if exists comms_review_approval_guard on public.comms_review_approvals;
create trigger comms_review_approval_guard
  before insert on public.comms_review_approvals
  for each row execute function public.comms_review_approval_guard();

-- A run may only be completed once, and only its outcome columns may move.
create or replace function public.comms_review_run_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status <> 'running' then
    raise exception 'A finished review run is a record, not a draft.';
  end if;
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.session_id <> old.session_id
     or new.version_id <> old.version_id
     or new.started_at <> old.started_at
     or new.created_by is distinct from old.created_by then
    raise exception 'A review run cannot be re-pointed after it started.';
  end if;
  return new;
end;
$$;

drop trigger if exists comms_review_run_guard on public.comms_review_runs;
create trigger comms_review_run_guard
  before update on public.comms_review_runs
  for each row execute function public.comms_review_run_guard();

-- A finding's words never change. Only the human decision on it does.
create or replace function public.comms_review_finding_guard()
returns trigger
language plpgsql
as $$
begin
  if new.id <> old.id
     or new.organization_id <> old.organization_id
     or new.run_id <> old.run_id
     or new.version_id <> old.version_id
     or new.kind <> old.kind
     or new.severity <> old.severity
     or new.excerpt is distinct from old.excerpt
     or new.excerpt_start is distinct from old.excerpt_start
     or new.excerpt_end is distinct from old.excerpt_end
     or new.why <> old.why
     or new.suggestion is distinct from old.suggestion then
    raise exception 'A review finding is a record. Only its decision may change.';
  end if;
  if new.state <> old.state then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists comms_review_finding_guard on public.comms_review_findings;
create trigger comms_review_finding_guard
  before update on public.comms_review_findings
  for each row execute function public.comms_review_finding_guard();

-- ---------------------------------------------------------------------------
-- Grants. PostgREST grants nothing on public by default.
-- Note what is deliberately absent: no UPDATE or DELETE for members on
-- versions, sources, obligations or approvals.
-- ---------------------------------------------------------------------------

grant select, insert, update on public.comms_review_sessions to authenticated;
grant select, insert on public.comms_review_versions to authenticated;
grant select, insert on public.comms_review_sources to authenticated;
grant select, insert, update on public.comms_review_runs to authenticated;
grant select, insert, update on public.comms_review_findings to authenticated;
grant select, insert on public.comms_review_obligations to authenticated;
grant select, insert on public.comms_review_approvals to authenticated;

grant all on public.comms_review_sessions to service_role;
grant all on public.comms_review_versions to service_role;
grant all on public.comms_review_sources to service_role;
grant all on public.comms_review_runs to service_role;
grant all on public.comms_review_findings to service_role;
grant all on public.comms_review_obligations to service_role;
grant all on public.comms_review_approvals to service_role;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.comms_review_sessions enable row level security;
alter table public.comms_review_versions enable row level security;
alter table public.comms_review_sources enable row level security;
alter table public.comms_review_runs enable row level security;
alter table public.comms_review_findings enable row level security;
alter table public.comms_review_obligations enable row level security;
alter table public.comms_review_approvals enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array[
    'comms_review_sessions',
    'comms_review_versions',
    'comms_review_sources',
    'comms_review_runs',
    'comms_review_findings',
    'comms_review_obligations',
    'comms_review_approvals'
  ]
  loop
    -- Members of the owning organization may read.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_read') then
      execute format(
        'create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))',
        t || '_read', t);
    end if;
    -- Service role keeps full access for server-side maintenance.
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_service_role') then
      execute format(
        'create policy %I on public.%I for all using (auth.role() = ''service_role'')',
        t || '_service_role', t);
    end if;
  end loop;
end
$$;

do $$
declare
  t text;
begin
  -- Active members may create review work in their own workspace.
  foreach t in array array[
    'comms_review_sessions',
    'comms_review_versions',
    'comms_review_sources',
    'comms_review_runs',
    'comms_review_findings',
    'comms_review_obligations'
  ]
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_insert') then
      execute format(
        'create policy %I on public.%I for insert to authenticated with check (private.is_org_member(organization_id))',
        t || '_insert', t);
    end if;
  end loop;
end
$$;

-- The two narrow updates, each already policed by a trigger above.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comms_review_sessions' and policyname = 'comms_review_sessions_update') then
    create policy comms_review_sessions_update on public.comms_review_sessions
      for update to authenticated
      using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comms_review_runs' and policyname = 'comms_review_runs_update') then
    create policy comms_review_runs_update on public.comms_review_runs
      for update to authenticated
      using (private.is_org_member(organization_id) and status = 'running')
      with check (private.is_org_member(organization_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comms_review_findings' and policyname = 'comms_review_findings_update') then
    create policy comms_review_findings_update on public.comms_review_findings
      for update to authenticated
      using (private.is_org_member(organization_id))
      with check (private.is_org_member(organization_id));
  end if;
end
$$;

-- Approval is the one act ordinary membership does not buy.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comms_review_approvals' and policyname = 'comms_review_approvals_insert') then
    create policy comms_review_approvals_insert on public.comms_review_approvals
      for insert to authenticated
      with check (private.is_org_admin(organization_id) and approved_by = auth.uid());
  end if;
end
$$;
