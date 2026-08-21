-- Trust Tai OS — Website measurement tables.
--
-- Additive and provider neutral. GA4 and Search Console are two possible
-- producers of these shapes; nothing here names a vendor. Canonical entities
-- are untouched: prospects, activities, website_intake_submissions and
-- website_events remain the source of truth for identity, history and intake.
--
-- Idempotent. Safe to run more than once.

create extension if not exists "pgcrypto";

/* ------------------------------------------------------------ website_pages */

create table if not exists public.website_pages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- normalized path, always the join key: leading slash, no host, no query
  path text not null,
  url text,
  title text not null default '',
  page_type text not null default 'page'
    check (page_type in ('page', 'blog', 'case_study', 'landing_page')),

  published_at timestamptz,
  last_updated_at timestamptz,

  -- null means Core has not been told, which is not the same as false
  indexable boolean,
  in_sitemap boolean,
  canonical_url text,
  primary_cta text,
  topic text,

  -- what Studio can populate when approved content is published
  content_intent jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists website_pages_key_idx
  on public.website_pages (organization_id, path);

revoke all on public.website_pages from anon;
revoke all on public.website_pages from authenticated;
grant select on public.website_pages to authenticated;
grant all on public.website_pages to service_role;

alter table public.website_pages enable row level security;

drop policy if exists "members read website pages" on public.website_pages;
create policy "members read website pages"
  on public.website_pages
  for select
  to authenticated
  using (private.is_org_member(organization_id));

/* -------------------------------------------- website_page_metrics_daily */

create table if not exists public.website_page_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'ga4',
  metric_date date not null,
  path text not null,
  title text,

  views integer not null default 0,
  users integer not null default 0,
  landing_sessions integer not null default 0,
  engaged_sessions integer not null default 0,
  average_engagement_seconds numeric not null default 0,

  source text,
  medium text,
  device text,
  country text,

  received_at timestamptz not null default now()
);

create unique index if not exists website_page_metrics_daily_key_idx
  on public.website_page_metrics_daily (
    organization_id, provider, metric_date, path,
    coalesce(source, ''), coalesce(medium, ''),
    coalesce(device, ''), coalesce(country, '')
  );
create index if not exists website_page_metrics_daily_time_idx
  on public.website_page_metrics_daily (organization_id, metric_date desc);

revoke all on public.website_page_metrics_daily from anon;
revoke all on public.website_page_metrics_daily from authenticated;
grant select on public.website_page_metrics_daily to authenticated;
grant all on public.website_page_metrics_daily to service_role;

alter table public.website_page_metrics_daily enable row level security;

drop policy if exists "members read website page metrics"
  on public.website_page_metrics_daily;
create policy "members read website page metrics"
  on public.website_page_metrics_daily
  for select
  to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------------------ website_search_metrics_daily */

create table if not exists public.website_search_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'search_console',
  metric_date date not null,
  query text not null,
  path text not null,

  clicks integer not null default 0,
  impressions integer not null default 0,
  average_position numeric not null default 0,

  device text,
  country text,

  received_at timestamptz not null default now()
);

create unique index if not exists website_search_metrics_daily_key_idx
  on public.website_search_metrics_daily (
    organization_id, provider, metric_date, query, path,
    coalesce(device, ''), coalesce(country, '')
  );
create index if not exists website_search_metrics_daily_time_idx
  on public.website_search_metrics_daily (organization_id, metric_date desc);

revoke all on public.website_search_metrics_daily from anon;
revoke all on public.website_search_metrics_daily from authenticated;
grant select on public.website_search_metrics_daily to authenticated;
grant all on public.website_search_metrics_daily to service_role;

alter table public.website_search_metrics_daily enable row level security;

drop policy if exists "members read website search metrics"
  on public.website_search_metrics_daily;
create policy "members read website search metrics"
  on public.website_search_metrics_daily
  for select
  to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------- widen the first party event vocabulary */

alter table public.website_events
  drop constraint if exists website_events_event_name_check;

alter table public.website_events
  add constraint website_events_event_name_check check (event_name in (
    'page_view',
    'cta_clicked',
    'intake_view',
    'intake_started',
    'intake_answered',
    'intake_resume_requested',
    'intake_resumed',
    'intake_submitted',
    'intake_abandoned',
    'content_read',
    'contact_clicked',
    'newsletter_subscribed'
  ));
