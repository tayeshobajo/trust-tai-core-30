-- PROPOSED, UNAPPLIED. Canonical Steward preparation runner.
-- Mirrors the REAL repo contracts: public.steward_tasks (20260921160000)
-- and public.conversations (docs/steward-v1-schema.sql, transcript jsonb).
-- Identity is ALWAYS derived from auth.uid(); no caller-supplied actor is
-- accepted anywhere. claim/complete/fail are WORKER-ONLY (service_role):
-- a signed-in client can request a run but can never claim, complete or
-- fail one, so nobody can forge an assistant artifact. The worker path
-- revalidates the requester's CURRENT membership, role and task authority
-- on every transition. Snapshots persist resolved immutable content +
-- digest; execution never rereads mutable sources.
--
-- Execute is revoked from PUBLIC/anon/authenticated here; the only
-- activation path is the separately reviewed grants.review.sql.

create schema if not exists private;
create extension if not exists pgcrypto; -- sha256 digests
create extension if not exists "uuid-ossp"; -- deterministic sync operation UUIDs

-- Membership helpers mirror the existing cmd-task-manager contracts.
-- Arbitrary-user variants first (the auth.uid() wrappers below and the
-- WORKER path, which has no auth.uid(), both build on these). The worker
-- revalidates the run's requester on every claim, complete and fail, so a
-- deactivated or demoted requester's run dies.
create or replace function private.steward_user_can_write(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = uid and m.status = 'active'
      and m.role in ('owner','admin','leadership','project_lead','client_support','team_member','member'))
$$;

create or replace function private.steward_user_is_admin(org uuid, uid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = uid and m.status = 'active'
      and m.role in ('owner','admin'))
$$;

create or replace function private.steward_is_active_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active')
$$;

create or replace function private.steward_can_write(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.steward_user_can_write(org, auth.uid())
$$;

create or replace function private.steward_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.steward_user_is_admin(org, auth.uid())
$$;

-- Task authority for an arbitrary user: creator, current owner, or org
-- admin. NULL-safe: an ownerless task is admin-only, never public.
create or replace function private.steward_user_has_task_authority(
  p_task public.steward_tasks, uid uuid
) returns boolean
language sql stable security definer set search_path = '' as $$
  select uid is not null and (
    p_task.created_by is not distinct from uid
    or p_task.owner_user_id is not distinct from uid
    or private.steward_user_is_admin(p_task.organization_id, uid))
$$;

-- Additive columns the canonical backend needs on the REAL steward_tasks.
-- All nullable or defaulted; existing rows and code are unaffected.
alter table public.steward_tasks
  add column if not exists revision integer not null default 0,
  add column if not exists task_visibility text not null default 'business',
  add column if not exists completion_evidence text,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by uuid,
  add column if not exists archived_at timestamptz;

create table if not exists public.steward_canonical_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  action text not null check (action in ('prepare_brief','prepare_handoff','draft_roadmap','review_output')),
  client_operation_id uuid not null,
  -- sha256 over org + task + requester + action + full input snapshot.
  request_digest text not null,
  -- [{kind, id, revision, content, content_digest}] — resolved immutable
  -- content at request time; execution never rereads mutable sources.
  input_snapshot jsonb not null,
  status text not null default 'queued' check (status in ('queued','running','complete','failed')),
  artifact_text text,
  artifact_digest text,
  evidence_refs jsonb not null default '[]'::jsonb,
  requested_by uuid not null,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  -- Fencing: every claim issues a fresh token + bumps the version; complete
  -- and fail require the CURRENT token, so a stale worker cannot finish a
  -- run that has been reclaimed.
  claim_token uuid,
  claim_version integer not null default 0,
  lease_expires_at timestamptz,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, client_operation_id)
);

alter table public.steward_canonical_runs enable row level security;

-- Read-only to active org members, business-visibility tasks only: runs
-- over personal tasks are never accepted (pilot scope), and their rows
-- must not leak org-wide even if one somehow existed.
create policy steward_canonical_runs_select on public.steward_canonical_runs
  for select to authenticated using (
    private.steward_is_active_member(organization_id)
    and exists (select 1 from public.steward_tasks t
                where t.id = task_id and t.task_visibility = 'business'));

-- Resolve a selected input ref to its CURRENT stored content from the REAL
-- tables. Transcript content is the canonical jsonb text of
-- public.conversations.transcript; its "revision" is 0 — integrity is
-- carried by the content digest. Returns no row when the input does not
-- exist, is outside the org, or is inaccessible to the caller.
create or replace function public.steward_resolve_input(p_org uuid, p_kind text, p_id uuid)
returns table(content text, revision integer)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if p_kind = 'transcript' then
    return query select c.transcript::text, 0
      from public.conversations c
      where c.id = p_id and c.organization_id = p_org;
  elsif p_kind = 'task_notes' then
    return query select t.notes, t.revision
      from public.steward_tasks t
      where t.id = p_id and t.organization_id = p_org
        and (t.task_visibility <> 'personal' or t.owner_user_id = auth.uid());
  end if;
end;
$$;

-- Request a run. Same operation + same payload replays the existing run
-- (after reauthorizing the current caller AND the current task state);
-- same operation + changed payload conflicts; a new operation UUID is a
-- deliberate rerun. Pilot scope: business-visibility tasks only.
-- Return contract: jsonb {run: <steward_canonical_runs row>, replayed:
-- boolean}. The explicit replayed flag is the ONLY reliable replay signal
-- — a replayed run is indistinguishable from a fresh one by row content.
drop function if exists public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb);
create or replace function public.steward_request_canonical_run(
  p_org uuid,
  p_task uuid,
  p_action text,
  p_operation uuid,
  p_input_refs jsonb -- [{kind, id}] — content is resolved server-side
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  task public.steward_tasks;
  ref jsonb;
  resolved record;
  snapshot jsonb := '[]'::jsonb;
  digest text;
  existing public.steward_canonical_runs;
  inserted public.steward_canonical_runs;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;

  -- Reauthorize the scoped task FIRST, before any replay: ownership or
  -- visibility changes since the original request must not be bypassed by
  -- a replayed operation UUID.
  select * into task from public.steward_tasks where id = p_task and organization_id = p_org;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  if task.task_visibility is distinct from 'business' then
    raise exception 'personal_tasks_out_of_scope' using errcode = 'P0401';
  end if;
  if not private.steward_user_has_task_authority(task, actor) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;

  if p_action not in ('prepare_brief','prepare_handoff','draft_roadmap','review_output') then
    raise exception 'action_not_allowed' using errcode = 'P0422';
  end if;
  if p_input_refs is null or jsonb_typeof(p_input_refs) <> 'array' or jsonb_array_length(p_input_refs) = 0 then
    raise exception 'inputs_required' using errcode = 'P0422';
  end if;
  for ref in select * from jsonb_array_elements(p_input_refs) loop
    select * into resolved from public.steward_resolve_input(p_org, ref->>'kind', (ref->>'id')::uuid);
    if not found or resolved.content is null or char_length(resolved.content) = 0 then
      raise exception 'input_inaccessible: %:%', ref->>'kind', ref->>'id' using errcode = 'P0403';
    end if;
    snapshot := snapshot || jsonb_build_object(
      'kind', ref->>'kind',
      'id', ref->>'id',
      'revision', resolved.revision,
      'content', resolved.content,
      'content_digest', encode(sha256(convert_to(resolved.content, 'utf8')), 'hex'));
  end loop;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'task', p_task, 'requester', actor,
    'action', p_action, 'inputs', snapshot)::text, 'utf8')), 'hex');

  select * into existing from public.steward_canonical_runs
    where organization_id = p_org and client_operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return jsonb_build_object('run', to_jsonb(existing), 'replayed', true); -- replay after full reauthorization above
  end if;

  insert into public.steward_canonical_runs
    (organization_id, task_id, action, client_operation_id, request_digest, input_snapshot, requested_by)
  values (p_org, p_task, p_action, p_operation, digest, snapshot, actor)
  returning * into inserted;
  return jsonb_build_object('run', to_jsonb(inserted), 'replayed', false);
exception
  when unique_violation then
    -- Concurrent duplicate request: reliably replay the winner's row.
    select * into existing from public.steward_canonical_runs
      where organization_id = p_org and client_operation_id = p_operation;
    if found and existing.request_digest is not distinct from digest then
      return existing;
    end if;
    raise exception 'operation_conflict' using errcode = 'P0002';
end;
$$;

-- WORKER-ONLY transitions. claim/complete/fail require the service_role
-- credential the server already holds — no new secret, no client grant.
-- Every transition revalidates the requester's CURRENT membership, write
-- role and task authority, so a deactivated or demoted requester's run
-- cannot be claimed or finished.

create or replace function private.steward_revalidate_requester(run public.steward_canonical_runs)
returns void
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  task public.steward_tasks;
begin
  if not private.steward_user_can_write(run.organization_id, run.requested_by) then
    raise exception 'requester_not_authorized' using errcode = 'P0401';
  end if;
  select * into task from public.steward_tasks
    where id = run.task_id and organization_id = run.organization_id;
  if not found or task.task_visibility is distinct from 'business'
     or not private.steward_user_has_task_authority(task, run.requested_by) then
    raise exception 'requester_not_authorized' using errcode = 'P0401';
  end if;
end;
$$;

-- Claim a run. Returns the row WITH the fresh fencing token; a concurrent
-- or stale claim gets no row.
create or replace function public.steward_claim_canonical_run(
  p_run uuid,
  p_lease_seconds integer default 300
) returns public.steward_canonical_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  run public.steward_canonical_runs;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'worker_only' using errcode = 'P0401';
  end if;
  select * into run from public.steward_canonical_runs where id = p_run for update;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0404';
  end if;
  perform private.steward_revalidate_requester(run);
  -- Exhausted attempts terminally fail.
  update public.steward_canonical_runs
     set status = 'failed', failure_reason = 'attempts exhausted', updated_at = now()
   where id = p_run
     and status in ('queued','running') and attempts >= max_attempts;
  update public.steward_canonical_runs
     set status = 'running', attempts = attempts + 1,
         claim_token = gen_random_uuid(), claim_version = claim_version + 1,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_run
     and (status = 'queued' or (status = 'running' and lease_expires_at <= now()))
  returning * into run;
  return run; -- null composite when the claim was lost
end;
$$;

-- Complete a run. Requires the CURRENT fencing token and an unexpired
-- lease, so a stale worker from a previous claim cannot finish the run.
create or replace function public.steward_complete_canonical_run(
  p_run uuid,
  p_claim_token uuid,
  p_artifact text,
  p_evidence_refs jsonb default '[]'::jsonb
) returns public.steward_canonical_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  run public.steward_canonical_runs;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'worker_only' using errcode = 'P0401';
  end if;
  if p_artifact is null or char_length(p_artifact) = 0 then
    raise exception 'artifact_required' using errcode = 'P0422';
  end if;
  select * into run from public.steward_canonical_runs where id = p_run;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0404';
  end if;
  perform private.steward_revalidate_requester(run);
  update public.steward_canonical_runs
     set status = 'complete', artifact_text = p_artifact,
         artifact_digest = encode(sha256(convert_to(p_artifact, 'utf8')), 'hex'),
         evidence_refs = coalesce(p_evidence_refs, '[]'::jsonb),
         claim_token = null, lease_expires_at = null, updated_at = now()
   where id = p_run
     and status = 'running' and claim_token = p_claim_token
     and lease_expires_at > now()
  returning * into run;
  if not found then
    raise exception 'claim_lost' using errcode = 'P0409';
  end if;
  return run;
end;
$$;

-- Fail a run with the same fencing rules, including an unexpired lease.
-- Requeues while attempts remain, terminally fails at the attempt budget.
create or replace function public.steward_fail_canonical_run(
  p_run uuid,
  p_claim_token uuid,
  p_reason text
) returns public.steward_canonical_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  run public.steward_canonical_runs;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'worker_only' using errcode = 'P0401';
  end if;
  select * into run from public.steward_canonical_runs where id = p_run;
  if not found then
    raise exception 'run_not_found' using errcode = 'P0404';
  end if;
  perform private.steward_revalidate_requester(run);
  update public.steward_canonical_runs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         failure_reason = left(coalesce(p_reason, ''), 500),
         claim_token = null, lease_expires_at = null, updated_at = now()
   where id = p_run
     and status = 'running' and claim_token = p_claim_token
     and lease_expires_at > now()
  returning * into run;
  if not found then
    raise exception 'claim_lost' using errcode = 'P0409';
  end if;
  return run;
end;
$$;

-- No implicit EXECUTE: activation is only via grants.review.sql.
revoke all on function public.steward_resolve_input(uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.steward_claim_canonical_run(uuid, integer) from public, anon, authenticated;
revoke all on function public.steward_complete_canonical_run(uuid, uuid, text, jsonb) from public, anon, authenticated;
revoke all on function public.steward_fail_canonical_run(uuid, uuid, text) from public, anon, authenticated;
-- RLS policies evaluate private.steward_is_active_member as the querying
-- role, so authenticated must keep EXECUTE on it (it is a read-only
-- security-definer membership check — safe to call, useless to abuse).
revoke all on function private.steward_is_active_member(uuid) from public, anon;
grant execute on function private.steward_is_active_member(uuid) to authenticated;
revoke all on function private.steward_can_write(uuid) from public, anon, authenticated;
revoke all on function private.steward_is_admin(uuid) from public, anon, authenticated;
revoke all on function private.steward_user_can_write(uuid, uuid) from public, anon, authenticated;
revoke all on function private.steward_user_is_admin(uuid, uuid) from public, anon, authenticated;
revoke all on function private.steward_user_has_task_authority(public.steward_tasks, uuid) from public, anon, authenticated;
revoke all on function private.steward_revalidate_requester(public.steward_canonical_runs) from public, anon, authenticated;
