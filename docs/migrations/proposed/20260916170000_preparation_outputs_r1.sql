-- PROPOSED, NOT APPLIED. For Codex review.
-- Revises docs/migrations/proposed/20260916130000_preparation_outputs.sql,
-- which was never applied. Treat this file as the whole proposal; the earlier
-- one should be discarded rather than applied first.
--
-- What changed, and why
--
--  1. The earlier draft froze finished_at and model_use for ever, while the
--     runner reuses one row across attempts. A permitted recovery therefore
--     could not write its own result. Attempt history now lives in its own
--     append-only table, so a retry adds to the record instead of overwriting
--     it, and the output row is frozen only once it genuinely finishes.
--  2. Claiming needs identity and a bounded lease: attempt_id and lease_until.
--     Without them a crashed worker leaves a row saying "running" for ever.
--  3. Owner is recorded as a verified membership id, not a label alone.
--  4. Subject binding is checked in the same workspace, and the trigger
--     refuses a row whose requester is not an active member of it.
--  5. Grants are minimal: members SELECT, the server INSERT/UPDATE, nobody
--     DELETE or TRUNCATE, so prepared history cannot be quietly erased.
--
-- Everything ships off: preparation_policy still defaults to no enabled jobs.

/* ------------------------------------------------------------- the output */

create table if not exists public.preparation_outputs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id text not null check (job_id in (
    'enquiry_qualification_packet',
    'conversation_summary',
    'milestone_status_draft'
  )),
  subject_ref text not null,
  input_revision text not null,
  -- organization::job::subject::revision. One row per revision; retries reuse it.
  idempotency_key text not null,
  trigger_event_id text,
  status text not null check (status in (
    'queued','running','prepared','needs_decision','could_not_finish','cancelled','uncertain'
  )),
  -- The attempt that holds this row right now, and until when.
  attempt_id uuid,
  lease_until timestamptz,
  summary text not null default '',
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  -- Deterministic figures, computed in code. NULL means not computed, never zero.
  figures jsonb check (figures is null or jsonb_typeof(figures) = 'object'),
  owner_label text not null,
  -- The verified membership behind that label. A label alone is not an owner.
  owner_membership_id uuid references public.organization_memberships(id) on delete set null,
  attempts integer not null default 0 check (attempts >= 0),
  -- provider, model, instructions ref and hash, input revision, input refs,
  -- usage/cost when reported. NULL means no model was used; an absent usage
  -- key means not reported, which is not the same as zero.
  model_use jsonb check (model_use is null or jsonb_typeof(model_use) = 'object'),
  because text,
  superseded_because text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key),
  -- A lease without an attempt, or the other way round, is not a claim.
  constraint preparation_outputs_claim_pair
    check ((attempt_id is null) = (lease_until is null))
);

create index if not exists preparation_outputs_org_job_created_idx
  on public.preparation_outputs (organization_id, job_id, created_at desc);
create index if not exists preparation_outputs_subject_idx
  on public.preparation_outputs (organization_id, subject_ref);
-- Recovering abandoned claims.
create index if not exists preparation_outputs_lease_idx
  on public.preparation_outputs (status, lease_until)
  where status = 'running';

/* ---------------------------------------------------- the attempt history */

-- Append-only. One row per attempt, kept even when the attempt failed, so a
-- retry that succeeds does not erase the evidence of what went wrong.
create table if not exists public.preparation_attempts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  job_id text not null,
  subject_ref text not null,
  input_revision text not null,
  idempotency_key text not null,
  attempt_id uuid not null,
  attempt_number integer not null check (attempt_number >= 1),
  trigger_event_id text,
  requested_by uuid references auth.users(id) on delete set null,
  status text not null,
  because text,
  model_use jsonb check (model_use is null or jsonb_typeof(model_use) = 'object'),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique (organization_id, attempt_id)
);

create index if not exists preparation_attempts_org_day_idx
  on public.preparation_attempts (organization_id, job_id, started_at desc);

/* ------------------------------------------------------------ the policy */

create table if not exists public.preparation_policy (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  -- Off until an authorised person turns a job on.
  enabled_jobs jsonb not null default '[]'::jsonb check (jsonb_typeof(enabled_jobs) = 'array'),
  stop_switch boolean not null default false,
  per_job_daily_limit integer not null default 50 check (per_job_daily_limit between 0 and 1000),
  workspace_daily_limit integer not null default 200 check (workspace_daily_limit between 0 and 5000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

/* ------------------------------------------------------------ privileges */

-- Least privilege, stated as a revoke first so an inherited grant cannot widen
-- this by accident. No DELETE or TRUNCATE for any application role.
revoke all on public.preparation_outputs from public, anon, authenticated, service_role;
revoke all on public.preparation_attempts from public, anon, authenticated, service_role;
revoke all on public.preparation_policy from public, anon, authenticated, service_role;

grant select on public.preparation_outputs to authenticated;
grant select, insert, update on public.preparation_outputs to service_role;

grant select on public.preparation_attempts to authenticated;
grant select, insert, update on public.preparation_attempts to service_role;

grant select on public.preparation_policy to authenticated;
grant select, insert, update on public.preparation_policy to service_role;

alter table public.preparation_outputs enable row level security;
alter table public.preparation_attempts enable row level security;
alter table public.preparation_policy enable row level security;

create policy "members read preparation outputs"
  on public.preparation_outputs for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = preparation_outputs.organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ));

create policy "members read preparation attempts"
  on public.preparation_attempts for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = preparation_attempts.organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ));

create policy "members read preparation policy"
  on public.preparation_policy for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = preparation_policy.organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  ));

/* ------------------------------------------------------------ invariants */

-- Request identity is frozen from the first write. Finished content is frozen
-- once a run genuinely finishes, and a finished run is only reopened by a
-- permitted recovery: a new attempt_id with a fresh lease and a higher attempt
-- number. That is the one door retries need, and it is not a way to rewrite a
-- result in place.
create or replace function public.preparation_outputs_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  reopening boolean;
begin
  if new.organization_id is distinct from old.organization_id
     or new.job_id is distinct from old.job_id
     or new.subject_ref is distinct from old.subject_ref
     or new.input_revision is distinct from old.input_revision
     or new.idempotency_key is distinct from old.idempotency_key
     or new.requested_by is distinct from old.requested_by
     or new.created_at is distinct from old.created_at
  then
    raise exception 'preparation output identity is immutable';
  end if;

  if new.attempts < old.attempts then
    raise exception 'preparation attempts never go backwards';
  end if;

  reopening := new.status = 'running'
    and new.attempt_id is not null
    and new.attempt_id is distinct from old.attempt_id
    and new.lease_until is not null
    and new.attempts > old.attempts;

  -- A finished run keeps its result unless a new attempt is properly claimed.
  if old.finished_at is not null and not reopening then
    if new.summary is distinct from old.summary
       or new.suggestions is distinct from old.suggestions
       or new.model_use is distinct from old.model_use
       or new.finished_at is distinct from old.finished_at
       or new.status is distinct from old.status
    then
      raise exception 'finished preparation evidence is immutable outside a new attempt';
    end if;
  end if;

  -- Only the attempt holding the claim may write the result of that claim.
  if old.status = 'running'
     and old.attempt_id is not null
     and not reopening
     and new.attempt_id is distinct from old.attempt_id
  then
    raise exception 'only the attempt holding the claim may finish it';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists preparation_outputs_guard_trg on public.preparation_outputs;
create trigger preparation_outputs_guard_trg
  before update on public.preparation_outputs
  for each row execute function public.preparation_outputs_guard();

-- The attempt history is append-only in practice: nothing may rewrite what an
-- attempt was, only close it out.
create or replace function public.preparation_attempts_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.attempt_id is distinct from old.attempt_id
     or new.attempt_number is distinct from old.attempt_number
     or new.idempotency_key is distinct from old.idempotency_key
     or new.input_revision is distinct from old.input_revision
     or new.started_at is distinct from old.started_at
     or (old.finished_at is not null)
  then
    raise exception 'preparation attempt history is append only';
  end if;
  return new;
end;
$$;

drop trigger if exists preparation_attempts_guard_trg on public.preparation_attempts;
create trigger preparation_attempts_guard_trg
  before update on public.preparation_attempts
  for each row execute function public.preparation_attempts_guard();

-- The subject must belong to the same workspace as the row, and the requester,
-- when there is one, must be an active member of it.
create or replace function public.preparation_outputs_binding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.requested_by is not null and not exists (
    select 1 from public.organization_memberships m
    where m.organization_id = new.organization_id
      and m.user_id = new.requested_by
      and m.status = 'active'
  ) then
    raise exception 'preparation may only be requested by an active member of that workspace';
  end if;

  if new.owner_membership_id is not null and not exists (
    select 1 from public.organization_memberships m
    where m.id = new.owner_membership_id
      and m.organization_id = new.organization_id
  ) then
    raise exception 'the decision owner must be a member of that workspace';
  end if;

  return new;
end;
$$;

drop trigger if exists preparation_outputs_binding_trg on public.preparation_outputs;
create trigger preparation_outputs_binding_trg
  before insert or update on public.preparation_outputs
  for each row execute function public.preparation_outputs_binding();
