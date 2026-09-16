-- PROPOSED, NOT APPLIED. For Codex review.
-- Repeatable preparation: one output record kind plus the per-workspace policy.
-- This adds no business entity. Prospects, relationships, roadmaps and projects
-- remain the only owners of their state; a row here points at a subject by
-- reference and holds prepared, not-yet-accepted work.
--
-- Everything ships off: preparation_policy defaults to no enabled jobs.

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
  -- organization::job::subject::revision. One run per revision, retries update it.
  idempotency_key text not null,
  trigger_event_id text,
  status text not null check (status in (
    'queued','running','prepared','needs_decision','could_not_finish','cancelled','uncertain'
  )),
  summary text not null default '',
  suggestions jsonb not null default '[]'::jsonb check (jsonb_typeof(suggestions) = 'array'),
  evidence_refs jsonb not null default '[]'::jsonb check (jsonb_typeof(evidence_refs) = 'array'),
  -- Deterministic figures, computed in code. NULL means not computed, never zero.
  figures jsonb check (figures is null or jsonb_typeof(figures) = 'object'),
  owner_label text not null,
  attempts integer not null default 0 check (attempts >= 0),
  -- provider, model, instructions ref, input refs, usage/cost when reported.
  -- NULL means no model was used; an absent usage key means not reported.
  model_use jsonb check (model_use is null or jsonb_typeof(model_use) = 'object'),
  because text,
  superseded_because text,
  requested_by uuid references auth.users(id) on delete set null,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create index if not exists preparation_outputs_org_job_created_idx
  on public.preparation_outputs (organization_id, job_id, created_at desc);
create index if not exists preparation_outputs_subject_idx
  on public.preparation_outputs (organization_id, subject_ref);

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

-- Least privilege. Members read; only the server writes. No DELETE or TRUNCATE
-- for any application role, so prepared history cannot be quietly erased.
revoke all on public.preparation_outputs from public, anon, authenticated, service_role;
revoke all on public.preparation_policy from public, anon, authenticated, service_role;

grant select on public.preparation_outputs to authenticated;
grant select, insert, update on public.preparation_outputs to service_role;

grant select on public.preparation_policy to authenticated;
grant select, insert, update on public.preparation_policy to service_role;

alter table public.preparation_outputs enable row level security;
alter table public.preparation_policy enable row level security;

create policy "members read preparation outputs"
  on public.preparation_outputs for select to authenticated
  using (exists (
    select 1 from public.organization_memberships m
    where m.organization_id = preparation_outputs.organization_id
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

-- Prepared work is evidence of what a machine offered at a moment in time.
-- The request identity and the model record are frozen once written.
create or replace function public.preparation_outputs_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.organization_id is distinct from old.organization_id
     or new.job_id is distinct from old.job_id
     or new.subject_ref is distinct from old.subject_ref
     or new.input_revision is distinct from old.input_revision
     or new.idempotency_key is distinct from old.idempotency_key
     or (old.model_use is not null and new.model_use is distinct from old.model_use)
     or (old.finished_at is not null and new.finished_at is distinct from old.finished_at)
  then
    raise exception 'preparation output identity and model record are immutable';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists preparation_outputs_immutable_trg on public.preparation_outputs;
create trigger preparation_outputs_immutable_trg
  before update on public.preparation_outputs
  for each row execute function public.preparation_outputs_immutable();
