-- Trust Tai OS. Approvals V1: the human judgment layer.
--
-- Applied to the managed Trust Tai Supabase project (ref okydosoacqdnursmmenf).
-- Additive and idempotent: safe to run more than once.
--
-- Architecture note. These tables are *governance*, not business truth. They
-- record what a source room prepared, why it needed a person, what that person
-- decided, and where the decision was handed afterwards. They hold references
-- and small immutable audit snapshots. They never become a second copy of a
-- prospect, relationship, roadmap change, project or post. The source room
-- remains the only writer of its own state.
--
-- Security. RLS on all three tables, reusing the hardened
-- private.is_org_member(uuid). anon holds no privilege and appears in no
-- policy. Nothing is deletable: the decision trail is append-and-amend only.

create extension if not exists "pgcrypto";

/* --------------------------------------------------- approval requests */
create table if not exists public.approval_requests (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,

  source_app text not null
    check (source_app in ('scout','comms','roadmap','website','projects','ops','studio','content')),
  category text not null
    check (category in ('marketing','communication','qualification','strategy',
                        'delivery','creative','operations')),
  approval_type text not null,

  title text not null,
  summary text not null default '',
  why_it_needs_you text not null default '',

  status text not null default 'needs_review'
    check (status in ('needs_review','needs_context','ready','revision_requested',
                      'approved','rejected','queued','executed','verified')),
  urgency text not null default 'soon' check (urgency in ('now','soon','whenever')),
  impact text not null default 'medium' check (impact in ('high','medium','low')),

  -- Pointer into the owning room. Never a copy of the entity.
  source_entity jsonb not null default '{}'::jsonb,
  submitted_by jsonb not null default '{}'::jsonb,

  -- Stable identity of the source state: two submits never make two rows.
  source_key text not null,
  revision integer not null default 1,

  required_capability text not null default 'workspace.read',
  boundary jsonb not null default '{"willDo":[],"willNotDo":[]}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,

  -- Type-specific, read only by that type's renderer.
  payload jsonb not null default '{}'::jsonb,

  decision jsonb,
  downstream jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists approval_requests_source_key_idx
  on public.approval_requests (organization_id, source_key);

create index if not exists approval_requests_org_status_idx
  on public.approval_requests (organization_id, status, created_at desc);

create index if not exists approval_requests_org_app_idx
  on public.approval_requests (organization_id, source_app, created_at desc);

/* ------------------------------------------------------ approval items */
-- One member of a batch. AI handles the volume; only exceptions need a person.
create table if not exists public.approval_items (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id text not null references public.approval_requests(id) on delete cascade,

  item_key text not null,
  title text not null,
  state text not null default 'ready'
    check (state in ('ready','exception','failed','approved','rejected','executed')),
  exception_reasons jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  source_entity jsonb,
  position integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists approval_items_key_idx
  on public.approval_items (organization_id, request_id, item_key);

create index if not exists approval_items_request_idx
  on public.approval_items (organization_id, request_id, position);

/* ----------------------------------------------------- approval events */
-- Append-only. Notes, decisions, state changes and downstream handovers.
create table if not exists public.approval_events (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  request_id text not null references public.approval_requests(id) on delete cascade,

  kind text not null
    check (kind in ('submitted','resubmitted','note','decision','state_changed','downstream')),
  body text not null default '',
  actor jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index if not exists approval_events_request_idx
  on public.approval_events (organization_id, request_id, created_at desc);

/* ------------------------------------------------------------- security */

alter table public.approval_requests enable row level security;
alter table public.approval_items enable row level security;
alter table public.approval_events enable row level security;

revoke all on public.approval_requests from anon, authenticated;
revoke all on public.approval_items from anon, authenticated;
revoke all on public.approval_events from anon, authenticated;

grant select, insert, update on public.approval_requests to authenticated;
grant select, insert, update on public.approval_items to authenticated;
grant select, insert on public.approval_events to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['approval_requests','approval_items','approval_events'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_member_read'
    ) then
      execute format(
        'create policy %I on public.%I for select to authenticated
           using (private.is_org_member(organization_id))',
        t || '_member_read', t);
    end if;

    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_member_write'
    ) then
      execute format(
        'create policy %I on public.%I for insert to authenticated
           with check (private.is_org_member(organization_id))',
        t || '_member_write', t);
    end if;
  end loop;

  foreach t in array array['approval_requests','approval_items'] loop
    if not exists (
      select 1 from pg_policies
      where schemaname = 'public' and tablename = t and policyname = t || '_member_update'
    ) then
      execute format(
        'create policy %I on public.%I for update to authenticated
           using (private.is_org_member(organization_id))
           with check (private.is_org_member(organization_id))',
        t || '_member_update', t);
    end if;
  end loop;
end
$$;
