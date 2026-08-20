-- Intelligence Canon, reconciliation secret and hourly schedule.
--
-- Additive. One global config row, readable only by the service role. The
-- endpoint reads it through supabaseAdmin and compares the presented
-- x-reconcile-secret in constant time. The cron job reads the same row when it
-- builds the request header, so activating the schedule needs no app secret
-- and no deployment change.
--
-- Apply against the shared Trust Tai Supabase project (okydosoacqdnursmmenf).

create table if not exists public.intelligence_reconcile_config (
  -- One row only, and it is named.
  id text primary key default 'global' check (id = 'global'),
  secret text not null,
  created_at timestamptz not null default now(),
  rotated_at timestamptz not null default now()
);

-- Nobody but the service role. No anon, no authenticated, no policies.
revoke all on public.intelligence_reconcile_config from anon, authenticated;
grant all on public.intelligence_reconcile_config to service_role;

alter table public.intelligence_reconcile_config enable row level security;
-- Deliberately no policies: RLS with no policy denies every non-bypassing role.

-- Generate the secret in the database. It is never printed by the app and is
-- never copied into an environment variable.
insert into public.intelligence_reconcile_config (id, secret)
values ('global', encode(gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

-- Hourly schedule. The endpoint still enforces its own interval guard, the
-- single-flight lease, per case idempotency, the bounded case count, and the
-- no-execution law, so a duplicate schedule cannot double-run it.
select cron.schedule(
  'intelligence-reconcile-hourly',
  '7 * * * *',
  $$
  select net.http_post(
    url := 'https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/intelligence/reconcile',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-reconcile-secret', (select secret from public.intelligence_reconcile_config where id = 'global')
    ),
    body := '{}'::jsonb
  );
  $$
);

-- To rotate later, without touching the app:
-- update public.intelligence_reconcile_config
--   set secret = encode(gen_random_bytes(32), 'hex'), rotated_at = now()
--   where id = 'global';
--
-- To stop the job:
-- select cron.unschedule('intelligence-reconcile-hourly');
