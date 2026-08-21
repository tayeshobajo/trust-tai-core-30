-- Trust Tai OS — Website provider sync configuration and run state.
--
-- Additive and minimal. Two tables: one service role only secret and site
-- origin, one run record per provider so the room can tell fresh from stale
-- from failed. Nothing here fabricates measurement.
--
-- Apply against the shared Trust Tai Supabase project (okydosoacqdnursmmenf).
-- Idempotent. Safe to run more than once.

create extension if not exists "pgcrypto";

/* ------------------------------------------------------ website_sync_config */

create table if not exists public.website_sync_config (
  id text primary key default 'global' check (id = 'global'),
  secret text not null,
  -- The one canonical public site this deployment reads.
  site_origin text not null default 'https://trusttai.com',
  organization_id uuid references public.organizations(id) on delete set null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

revoke all on public.website_sync_config from anon, authenticated;
grant all on public.website_sync_config to service_role;
alter table public.website_sync_config enable row level security;
-- Deliberately no policies: RLS with no policy denies every non-bypassing role.

-- Generate the secret in the database. It is never printed by the app.
-- Set organization_id to the Trust Tai organization before enabling the job.
insert into public.website_sync_config (id, secret, site_origin)
values ('global', encode(gen_random_bytes(32), 'hex'), 'https://trusttai.com')
on conflict (id) do nothing;

/* ----------------------------------------------------- website_provider_sync */

create table if not exists public.website_provider_sync (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null check (provider in (
    'page_inventory', 'ga4', 'search_console', 'first_party_events', 'site_health'
  )),
  configured boolean not null default false,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  rows_written integer not null default 0,
  summary jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create unique index if not exists website_provider_sync_key_idx
  on public.website_provider_sync (organization_id, provider);

revoke all on public.website_provider_sync from anon;
revoke all on public.website_provider_sync from authenticated;
grant select on public.website_provider_sync to authenticated;
grant all on public.website_provider_sync to service_role;

alter table public.website_provider_sync enable row level security;

drop policy if exists "members read website provider sync" on public.website_provider_sync;
create policy "members read website provider sync"
  on public.website_provider_sync
  for select
  to authenticated
  using (private.is_org_member(organization_id));

/* ------------------------------------------------------------- the schedule */

-- Daily page inventory, conservative and bounded. The endpoint reads the same
-- secret row, so nothing has to be copied into a deployment.
select cron.schedule(
  'website-inventory-daily',
  '20 4 * * *',
  $$
  select net.http_post(
    url := 'https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/website/sync',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-website-sync-secret', (select secret from public.website_sync_config where id = 'global')
    ),
    body := '{"job":"inventory"}'::jsonb
  );
  $$
);

-- Enable these two only once the Google service account values are in place.
-- Until then the endpoint answers "not configured" and writes nothing.
--
-- select cron.schedule('website-ga4-daily', '35 4 * * *', $$
--   select net.http_post(
--     url := 'https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/website/sync',
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-website-sync-secret', (select secret from public.website_sync_config where id = 'global')
--     ),
--     body := '{"job":"ga4","days":7}'::jsonb);
-- $$);
--
-- select cron.schedule('website-search-console-daily', '50 4 * * *', $$
--   select net.http_post(
--     url := 'https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/website/sync',
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-website-sync-secret', (select secret from public.website_sync_config where id = 'global')
--     ),
--     body := '{"job":"search_console","days":7}'::jsonb);
-- $$);

-- To rotate the secret without touching the app:
-- update public.website_sync_config
--   set secret = encode(gen_random_bytes(32), 'hex'), rotated_at = now()
--   where id = 'global';
