-- Intelligence Canon, case learning schema.
--
-- Additive and org scoped. Two append-only tables holding intelligence, never
-- business truth: no prospect, project, message or transcript is copied here.
-- Pattern and chain definitions live in code (versioned with the app), so only
-- what the organization learned needs a table.
--
-- Apply against the shared Trust Tai Supabase project.

create table if not exists public.intelligence_cases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pattern_id text not null,
  pattern_version integer not null default 1,
  -- References only: [{ kind, id, label }]
  entities jsonb not null default '[]'::jsonb,
  -- Pointers to evidence as it stood: [{ kind: 'observation'|'activity'|'signal', id }]
  evidence_refs jsonb not null default '[]'::jsonb,
  hypothesis text not null,
  human_decision text not null,
  decided_by uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null,
  outcome text,
  outcome_at timestamptz,
  diagnosis_verdict text not null default 'unknown'
    check (diagnosis_verdict in ('correct', 'partly_correct', 'incorrect', 'unknown')),
  -- A person's correction. Outranks anything inferred from the result.
  correction text,
  lesson text,
  created_at timestamptz not null default now()
);

create index if not exists intelligence_cases_org_created_idx
  on public.intelligence_cases (organization_id, created_at desc);
create index if not exists intelligence_cases_pattern_idx
  on public.intelligence_cases (organization_id, pattern_id);

create table if not exists public.pattern_outcomes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  pattern_id text not null,
  pattern_version integer not null default 1,
  case_id uuid references public.intelligence_cases(id) on delete set null,
  recommendation text not null,
  decision text not null check (decision in ('accepted', 'edited', 'deferred', 'rejected')),
  result text not null check (result in ('success', 'failure', 'unknown')),
  result_because text not null,
  hours_to_outcome integer,
  human_correction text,
  recorded_by uuid not null references auth.users(id) on delete restrict,
  recorded_at timestamptz not null default now()
);

create index if not exists pattern_outcomes_org_pattern_idx
  on public.pattern_outcomes (organization_id, pattern_id, recorded_at desc);

grant select, insert on public.intelligence_cases to authenticated;
grant all on public.intelligence_cases to service_role;
grant select, insert on public.pattern_outcomes to authenticated;
grant all on public.pattern_outcomes to service_role;

alter table public.intelligence_cases enable row level security;
alter table public.pattern_outcomes enable row level security;

-- Active membership only, in both directions. Nothing is updatable or
-- deletable by an app user: a changed conclusion is a new row.
create policy "members read cases"
  on public.intelligence_cases for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = intelligence_cases.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "members append cases"
  on public.intelligence_cases for insert to authenticated
  with check (
    decided_by = auth.uid()
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = intelligence_cases.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "members read pattern outcomes"
  on public.pattern_outcomes for select to authenticated
  using (
    exists (
      select 1 from public.organization_memberships m
      where m.organization_id = pattern_outcomes.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );

create policy "members append pattern outcomes"
  on public.pattern_outcomes for insert to authenticated
  with check (
    recorded_by = auth.uid()
    and exists (
      select 1 from public.organization_memberships m
      where m.organization_id = pattern_outcomes.organization_id
        and m.user_id = auth.uid()
        and m.status = 'active'
    )
  );
