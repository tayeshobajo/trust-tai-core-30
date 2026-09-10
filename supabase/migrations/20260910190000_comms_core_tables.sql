-- Capture of live schema (project okydosoacqdnursmmenf, introspected 2026-09-10)
-- for the four core Comms tables previously applied only by hand from
-- docs/comms-v1-schema.sql, docs/comms-send-schema.sql, docs/comms-integrations-schema.sql.
-- Fully idempotent: safe to run against production (no-op) and against a fresh
-- database (reproduces the live structure, indexes, constraints, and RLS policies).
-- Assumes organizations, contacts, clients, prospects, and private.is_org_member
-- already exist, as the rest of the migration chain does.

-- ---------------------------------------------------------------------------
-- comms_relationships
-- ---------------------------------------------------------------------------
create table if not exists public.comms_relationships (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  contact_id uuid,
  client_id uuid,
  prospect_id uuid,
  full_name text not null,
  company_name text,
  email text,
  stage text not null default 'new',
  owner_user_id uuid,
  source text not null default 'manual',
  met_at timestamptz,
  met_where text,
  last_touch_at timestamptz,
  next_action text,
  response_due_at timestamptz,
  follow_up_due_at timestamptz,
  observed jsonb not null default '[]'::jsonb,
  inferred jsonb not null default '[]'::jsonb,
  decided jsonb not null default '[]'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_relationships_pkey primary key (id),
  constraint comms_relationships_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint comms_relationships_contact_id_fkey foreign key (contact_id) references public.contacts(id) on delete set null,
  constraint comms_relationships_client_id_fkey foreign key (client_id) references public.clients(id) on delete set null,
  constraint comms_relationships_prospect_id_fkey foreign key (prospect_id) references public.prospects(id) on delete set null,
  constraint comms_relationships_owner_user_id_fkey foreign key (owner_user_id) references auth.users(id) on delete set null,
  constraint comms_relationships_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null
);

create index if not exists comms_relationships_org_idx on public.comms_relationships (organization_id, stage);
create index if not exists comms_relationships_stage_idx on public.comms_relationships (organization_id, stage);
create index if not exists comms_relationships_updated_idx on public.comms_relationships (organization_id, updated_at desc);
create index if not exists comms_relationships_email_idx on public.comms_relationships (organization_id, email) where (email is not null);
create unique index if not exists comms_relationships_prospect_idx on public.comms_relationships (organization_id, prospect_id) where (prospect_id is not null);

-- ---------------------------------------------------------------------------
-- comms_threads
-- ---------------------------------------------------------------------------
create table if not exists public.comms_threads (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  relationship_id uuid not null,
  channel text not null default 'email',
  subject text,
  state text not null default 'open',
  last_message_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  provider text,
  provider_thread_id text,
  owner_user_id uuid,
  response_due_at timestamptz,
  constraint comms_threads_pkey primary key (id),
  constraint comms_threads_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint comms_threads_relationship_id_fkey foreign key (relationship_id) references public.comms_relationships(id) on delete cascade,
  constraint comms_threads_owner_user_id_fkey foreign key (owner_user_id) references auth.users(id) on delete set null,
  constraint comms_threads_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null
);

create index if not exists comms_threads_org_idx on public.comms_threads (organization_id, updated_at desc);
create index if not exists comms_threads_rel_idx on public.comms_threads (relationship_id);
create index if not exists comms_threads_relationship_idx on public.comms_threads (relationship_id, updated_at desc);
create unique index if not exists comms_threads_provider_idx on public.comms_threads (organization_id, provider, provider_thread_id) where (provider_thread_id is not null);

-- ---------------------------------------------------------------------------
-- comms_messages
-- ---------------------------------------------------------------------------
create table if not exists public.comms_messages (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  relationship_id uuid,
  thread_id uuid,
  provider text not null default 'gmail',
  provider_message_id text not null,
  provider_thread_id text,
  direction text not null default 'inbound',
  from_email text,
  from_name text,
  to_emails jsonb not null default '[]'::jsonb,
  cc_emails jsonb not null default '[]'::jsonb,
  subject text,
  snippet text,
  body_text text,
  occurred_at timestamptz not null,
  headers jsonb not null default '{}'::jsonb,
  provenance jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  attachments jsonb not null default '[]'::jsonb,
  body_html text,
  constraint comms_messages_pkey primary key (id),
  constraint comms_messages_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint comms_messages_relationship_id_fkey foreign key (relationship_id) references public.comms_relationships(id) on delete cascade,
  constraint comms_messages_thread_id_fkey foreign key (thread_id) references public.comms_threads(id) on delete set null
);

-- Idempotency key relied on by comms-gmail-send.server.ts and
-- comms-linkedin-send.server.ts (ON CONFLICT / upsert on provider message id).
-- Live schema implements it as a UNIQUE INDEX, not a table constraint.
create unique index if not exists comms_messages_provider_idx on public.comms_messages (organization_id, provider, provider_message_id);
create index if not exists comms_messages_rel_idx on public.comms_messages (relationship_id, occurred_at desc);
create index if not exists comms_messages_relationship_idx on public.comms_messages (relationship_id, occurred_at desc);
create index if not exists comms_messages_thread_idx on public.comms_messages (thread_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- comms_drafts
-- ---------------------------------------------------------------------------
create table if not exists public.comms_drafts (
  id uuid not null default gen_random_uuid(),
  organization_id uuid not null,
  relationship_id uuid not null,
  thread_id uuid,
  intent text not null default 'introduce',
  register text not null default 'warm_intro',
  subject text,
  body text not null,
  voice_version integer not null default 1,
  review_state text not null default 'draft',
  rationale jsonb not null default '{}'::jsonb,
  evidence jsonb not null default '[]'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint comms_drafts_pkey primary key (id),
  constraint comms_drafts_organization_id_fkey foreign key (organization_id) references public.organizations(id) on delete cascade,
  constraint comms_drafts_relationship_id_fkey foreign key (relationship_id) references public.comms_relationships(id) on delete cascade,
  constraint comms_drafts_thread_id_fkey foreign key (thread_id) references public.comms_threads(id) on delete set null,
  constraint comms_drafts_created_by_fkey foreign key (created_by) references auth.users(id) on delete set null
);

create index if not exists comms_drafts_org_review_idx on public.comms_drafts (organization_id, review_state, created_at desc);
create index if not exists comms_drafts_rel_idx on public.comms_drafts (relationship_id, created_at desc);
create index if not exists comms_drafts_relationship_idx on public.comms_drafts (relationship_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.comms_relationships enable row level security;
alter table public.comms_threads enable row level security;
alter table public.comms_messages enable row level security;
alter table public.comms_drafts enable row level security;

do $$
declare
  t record;
begin
  for t in
    select * from (values
      ('comms_relationships', 'relationships'),
      ('comms_threads',       'threads'),
      ('comms_messages',      'messages'),
      ('comms_drafts',        'drafts')
    ) as v(tbl, noun)
  loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members read ' || t.noun) then
      execute format('create policy %I on public.%I for select to authenticated using (private.is_org_member(organization_id))', 'Members read ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members write ' || t.noun) then
      execute format('create policy %I on public.%I for insert to authenticated with check (private.is_org_member(organization_id))', 'Members write ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members update ' || t.noun) then
      execute format('create policy %I on public.%I for update to authenticated using (private.is_org_member(organization_id)) with check (private.is_org_member(organization_id))', 'Members update ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = 'Members delete ' || t.noun) then
      execute format('create policy %I on public.%I for delete to authenticated using (private.is_org_member(organization_id))', 'Members delete ' || t.noun, t.tbl);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t.tbl and policyname = t.tbl || '_service_role') then
      execute format('create policy %I on public.%I for all using (auth.role() = ''service_role''::text)', t.tbl || '_service_role', t.tbl);
    end if;
  end loop;
end
$$;
