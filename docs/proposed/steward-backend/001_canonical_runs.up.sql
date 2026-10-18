-- PROPOSED, UNAPPLIED. Canonical preparation runs for shared board work.
-- Separate from the legacy agent runner: a run row is the ONLY record a
-- preparation run may write. It never touches steward_tasks status,
-- receipts, activities or verified counts.
--
-- Access note: every function here revokes execute from public/anon.
-- Granting execute to `authenticated` is a REQUIRED but UNRESOLVED step,
-- documented in README.md — it is not applied here.

create table if not exists steward_canonical_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references steward_tasks(id) on delete restrict,
  action text not null check (action in ('prepare_brief','draft_roadmap','prepare_handoff','review_output')),
  client_operation_id uuid not null,
  -- sha-256 of the canonical request payload (action + sorted input refs + revisions)
  request_digest text not null,
  -- immutable snapshot of selected inputs: [{ref, revision, content_hash}]
  input_snapshot jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','complete','failed')),
  artifact_text text,
  artifact_digest text,
  evidence_refs jsonb not null default '[]'::jsonb,
  requested_by uuid not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  lease_expires_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_operation_id)
);

create index if not exists steward_canonical_runs_task_idx
  on steward_canonical_runs (organization_id, task_id, created_at desc);

-- Request a run. Same operation UUID + same digest replays the existing row;
-- same operation UUID + different digest is a conflict; a new operation UUID
-- is an intentional rerun and always creates a new row.
create or replace function steward_request_canonical_run(
  p_org uuid,
  p_task uuid,
  p_action text,
  p_operation uuid,
  p_digest text,
  p_snapshot jsonb,
  p_actor uuid
) returns steward_canonical_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing steward_canonical_runs;
  created steward_canonical_runs;
  t steward_tasks;
begin
  select * into existing from steward_canonical_runs
   where organization_id = p_org and client_operation_id = p_operation;
  if found then
    if existing.request_digest <> p_digest then
      raise exception 'operation_conflict: operation % already used with a different payload', p_operation
        using errcode = 'P0002';
    end if;
    return existing;
  end if;

  select * into t from steward_tasks
   where id = p_task and organization_id = p_org for share;
  if not found then
    raise exception 'task_not_found_or_inaccessible' using errcode = 'P0003';
  end if;
  if t.created_by <> p_actor and t.owner_user_id <> p_actor then
    raise exception 'not_authorized: only the creator or owner may request preparation' using errcode = 'P0004';
  end if;

  insert into steward_canonical_runs
    (organization_id, task_id, action, client_operation_id, request_digest, input_snapshot, requested_by)
  values (p_org, p_task, p_action, p_operation, p_digest, p_snapshot, p_actor)
  returning * into created;
  return created;
end;
$$;

-- Claim a queued run (or recover an expired lease). The single-row UPDATE is
-- the concurrency guard: two racing claims cannot both succeed. A run whose
-- attempts are exhausted is terminally failed instead of stranded.
create or replace function steward_claim_canonical_run(
  p_run uuid,
  p_actor uuid,
  p_lease_seconds integer default 300
) returns steward_canonical_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  claimed steward_canonical_runs;
begin
  update steward_canonical_runs
     set status = 'failed',
         failure_reason = 'attempts exhausted',
         updated_at = now()
   where id = p_run
     and status in ('queued','running')
     and attempts >= max_attempts;

  update steward_canonical_runs
     set status = 'running',
         attempts = attempts + 1,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_run
     and requested_by = p_actor
     and (status = 'queued' or (status = 'running' and lease_expires_at <= now()))
  returning * into claimed;
  return claimed; -- null when another worker holds the claim
end;
$$;

create or replace function steward_complete_canonical_run(
  p_run uuid,
  p_actor uuid,
  p_artifact text,
  p_digest text,
  p_refs jsonb
) returns steward_canonical_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  done steward_canonical_runs;
begin
  update steward_canonical_runs
     set status = 'complete',
         artifact_text = p_artifact,
         artifact_digest = p_digest,
         evidence_refs = coalesce(p_refs, '[]'::jsonb),
         lease_expires_at = null,
         updated_at = now()
   where id = p_run
     and requested_by = p_actor
     and status = 'running'
  returning * into done;
  if not found then
    raise exception 'run_not_claimed: only the holder of a running claim may complete it' using errcode = 'P0005';
  end if;
  return done;
end;
$$;

create or replace function steward_fail_canonical_run(
  p_run uuid,
  p_actor uuid,
  p_reason text
) returns steward_canonical_runs
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  r steward_canonical_runs;
begin
  update steward_canonical_runs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         failure_reason = left(coalesce(p_reason, 'unknown'), 500),
         lease_expires_at = null,
         updated_at = now()
   where id = p_run
     and requested_by = p_actor
     and status = 'running'
  returning * into r;
  if not found then
    raise exception 'run_not_claimed' using errcode = 'P0005';
  end if;
  return r;
end;
$$;

revoke all on function steward_request_canonical_run(uuid,uuid,text,uuid,text,jsonb,uuid) from public, anon;
revoke all on function steward_claim_canonical_run(uuid,uuid,integer) from public, anon;
revoke all on function steward_complete_canonical_run(uuid,uuid,text,text,jsonb) from public, anon;
revoke all on function steward_fail_canonical_run(uuid,uuid,text) from public, anon;
