-- Trust Tai OS, the Content Engine (Studio) canonical store.
--
-- Canonical content lives here, in Marketing/Content. Approvals holds the
-- decision and a pointer, never a second copy of the article. The publish
-- adapter records transport receipts against the item that owns them.
--
-- Apply once against the Trust Tai backend (project okydosoacqdnursmmenf).

create table if not exists public.content_batches (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  keyword text not null,
  state text not null default 'preparing',
  topic_cluster jsonb not null default '[]'::jsonb,
  search_intent text not null default '',
  audience_problem text not null default '',
  editorial_plan jsonb not null default '[]'::jsonb,
  why_together text not null default '',
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.content_items (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  batch_id text not null references public.content_batches(id) on delete cascade,
  position integer not null default 0,
  slug text not null,
  title text not null,
  angle text not null default '',
  reader_job text not null default '',
  brief jsonb not null default '{}'::jsonb,
  draft_markdown text not null default '',
  hit_rationale text not null default '',
  seo jsonb not null default '{}'::jsonb,
  internal_links jsonb not null default '[]'::jsonb,
  cta jsonb not null default '{}'::jsonb,
  taxonomy jsonb not null default '{}'::jsonb,
  image jsonb not null default '{"state":"pending"}'::jsonb,
  generation jsonb not null default '{}'::jsonb,
  state text not null default 'preparing',
  exception_reasons jsonb not null default '[]'::jsonb,
  failure_reason text,
  publish_key text not null,
  publish jsonb not null default '{}'::jsonb,
  verification jsonb not null default '{}'::jsonb,
  external_post_id text,
  canonical_url text,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, batch_id, slug),
  unique (organization_id, publish_key)
);

create index if not exists content_items_batch_idx on public.content_items (organization_id, batch_id, position);

-- Every transport attempt, kept separate from the item's own state so
-- Attempted, Executed and Verified can never be collapsed into one another.
create table if not exists public.content_publish_attempts (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  item_id text not null references public.content_items(id) on delete cascade,
  publish_key text not null,
  state text not null,
  provider text not null default 'unconfigured',
  because text not null default '',
  receipt jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists content_publish_attempts_item_idx
  on public.content_publish_attempts (organization_id, item_id, created_at desc);

grant select, insert, update, delete on public.content_batches to authenticated;
grant select, insert, update, delete on public.content_items to authenticated;
grant select, insert on public.content_publish_attempts to authenticated;
grant all on public.content_batches to service_role;
grant all on public.content_items to service_role;
grant all on public.content_publish_attempts to service_role;

alter table public.content_batches enable row level security;
alter table public.content_items enable row level security;
alter table public.content_publish_attempts enable row level security;

create policy "content batches are workspace scoped"
  on public.content_batches for all to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = content_batches.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = content_batches.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "content items are workspace scoped"
  on public.content_items for all to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = content_items.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = content_items.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "publish attempts are workspace readable"
  on public.content_publish_attempts for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = content_publish_attempts.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );
