-- Intelligence Canon, governance and scheduled reconciliation schema.
--
-- Additive and org scoped. Two append-only tables holding governance, never
-- business truth. Nothing here edits canonical pattern text: accepting a
-- proposal authorises a later, versioned canon review by a person.
--
-- Apply against the shared Trust Tai Supabase project (okydosoacqdnursmmenf).

-- 1. A person's answer to one revision proposal, final for that fingerprint.
create table if not exists public.pattern_revision_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pattern_id text not null,
  pattern_version integer not null default 1,
  -- Content identity of the proposal: pattern, version, and wording.
  proposal_fingerprint text not null,
  proposal_text text not null,
  -- Outcome ids the proposal stood on: ["uuid", ...]
  outcome_refs jsonb not null default '[]'::jsonb,
  decision text not null check (decision in ('accepted', 'rejected', 'deferred')),
  note text,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null default now(),
  -- One answer per proposal, per organization. A new wording is a new question.
  unique (organization_id, proposal_fingerprint)
);

create index if not exists pattern_revision_decisions_org_idx
  on public.pattern_revision_decisions (organization_id, decided_at desc);

revoke all on public.pattern_revision_decisions from authenticated;
grant select, insert on public.pattern_revision_decisions to authenticated;
grant all on public.pattern_revision_decisions to service_role;

alter table public.pattern_revision_decisions enable row level security;

create policy "members read revision decisions"
  on public.pattern_revision_decisions for select to authenticated
  using (private.is_org_member(organization_id));

create policy "members append revision decisions"
  on public.pattern_revision_decisions for insert to authenticated
  with check (decided_by = auth.uid() and private.is_org_member(organization_id));

-- 2. Scheduled reconciliation runs: the single-flight lease and the audit
--    trail for the hourly job. Service role only; no app user writes here.
create table if not exists public.intelligence_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  -- 'running' holds the lease. 'done' / 'failed' release it.
  status text not null default 'running' check (status in ('running', 'done', 'failed')),
  -- Lease expiry, so a crashed run never blocks the next one forever.
  lease_expires_at timestamptz not null,
  cases_considered integer not null default 0,
  outcomes_written integer not null default 0,
  unknown_left_open integer not null default 0,
  note text
);

create index if not exists intelligence_reconciliation_runs_org_idx
  on public.intelligence_reconciliation_runs (organization_id, started_at desc);

revoke all on public.intelligence_reconciliation_runs from authenticated;
-- Members may read the audit trail. Only the job (service role) writes it.
grant select on public.intelligence_reconciliation_runs to authenticated;
grant all on public.intelligence_reconciliation_runs to service_role;

alter table public.intelligence_reconciliation_runs enable row level security;

create policy "members read reconciliation runs"
  on public.intelligence_reconciliation_runs for select to authenticated
  using (private.is_org_member(organization_id));

-- 3. Scheduling. Run no more often than hourly. The endpoint also enforces the
--    interval and the lease, so a duplicate schedule cannot double-run it.
--
-- select cron.schedule(
--   'intelligence-reconcile-hourly',
--   '7 * * * *',
--   $$
--   select net.http_post(
--     url := 'https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/intelligence/reconcile',
--     headers := jsonb_build_object(
--       'content-type', 'application/json',
--       'x-reconcile-secret', '<INTELLIGENCE_RECONCILE_SECRET>'
--     ),
--     body := '{}'::jsonb
--   );
--   $$
-- );
