-- Scout bounded watchlist sweep (P4-02).
--
-- One row per organization. It holds three things and nothing else:
--   1. the sweep settings a person chose (automatic on/off, cadence),
--   2. a single-flight lease so two runs never sweep the same watchlist at once,
--   3. the last run's counts, so the surface can report counts only.
--
-- No company data lives here. Evidence stays on `prospects`, history stays in
-- `prospect_evaluations`, and movement is derived, never stored as a flag.
--
-- Until this is applied, Scout falls back to default settings (automatic,
-- daily) and reports no previous run. A manual sweep still works.

create table if not exists public.scout_sweep_state (
    id uuid primary key default gen_random_uuid(),
    organization_id uuid not null,
    enabled boolean not null default true,
    cadence text not null default 'daily',
    lease_until timestamptz,
    lease_owner text,
    last_run_at timestamptz,
    last_run_kind text,
    watched_count integer not null default 0,
    read_count integer not null default 0,
    changed_count integer not null default 0,
    current_count integer not null default 0,
    unreadable_count integer not null default 0,
    skipped_count integer not null default 0,
    deferred_count integer not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint scout_sweep_state_org_uniq unique (organization_id),
    constraint scout_sweep_state_cadence_chk check (cadence in ('daily', 'weekly'))
);

grant select, insert, update on public.scout_sweep_state to authenticated;
grant all on public.scout_sweep_state to service_role;

alter table public.scout_sweep_state enable row level security;

drop policy if exists "service role full access" on public.scout_sweep_state;
create policy "service role full access" on public.scout_sweep_state
    for all to service_role using (true) with check (true);

drop policy if exists "members read own org sweep state" on public.scout_sweep_state;
create policy "members read own org sweep state"
    on public.scout_sweep_state for select
    to authenticated
    using (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = scout_sweep_state.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );

drop policy if exists "members insert own org sweep state" on public.scout_sweep_state;
create policy "members insert own org sweep state"
    on public.scout_sweep_state for insert
    to authenticated
    with check (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = scout_sweep_state.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );

drop policy if exists "members update own org sweep state" on public.scout_sweep_state;
create policy "members update own org sweep state"
    on public.scout_sweep_state for update
    to authenticated
    using (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = scout_sweep_state.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    ) with check (
        exists (
            select 1 from public.organization_memberships m
            where m.organization_id = scout_sweep_state.organization_id
              and m.user_id = auth.uid()
              and m.status = 'active'
        )
    );

create index if not exists scout_sweep_state_org_idx
    on public.scout_sweep_state (organization_id);

-- ---------------------------------------------------------------- schedule --
--
-- Cadence: once a day. Each run reads at most 10 watched companies per
-- organization, oldest first, and only when their evidence is missing or older
-- than 30 days. A run holds a single-flight lease, so a second run exits
-- instead of sweeping the same watchlist twice.
--
-- Auth: SCOUT_SWEEP_CRON_SECRET, a project env secret the endpoint compares in
-- constant time. No secret configured means the endpoint answers 503 and no
-- sweep can run. Never commit the real value.

-- select cron.schedule(
--   'scout-watchlist-sweep',
--   '23 4 * * *',
--   $$
--   select net.http_post(
--     url:= 'https://cmd.trusttai.com/api/public/scout/sweep',
--     headers:= jsonb_build_object(
--       'Content-Type', 'application/json',
--       'X-Scout-Sweep-Key', 'PASTE_SCOUT_SWEEP_CRON_SECRET'
--     ),
--     body:= '{}'::jsonb
--   );
--   $$
-- );
