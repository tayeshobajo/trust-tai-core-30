-- PROPOSED, UNAPPLIED. Canonical Steward preparation runner.
-- Identity is ALWAYS derived from auth.uid(); no caller-supplied actor is
-- accepted anywhere. Active org membership + write role are required for
-- every mutation, and replayed operations reauthorize the CURRENT caller.
-- Snapshots persist the resolved immutable input content + digest, not just
-- references, so a run can never silently execute against changed content.
--
-- Grants are NOT in this file: see grants.review.sql (separate exact review
-- script). RLS is enabled here with restrictive policies so enabling access
-- later cannot expose rows beyond org membership.

create schema if not exists private;

-- Membership helpers mirror the existing cmd-task-manager contracts
-- (private.is_org_member / cmd_can_write_tasks) and are security definer so
-- RLS policies and functions can check membership without recursion.
create or replace function private.steward_is_active_member(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active')
$$;

create or replace function private.steward_can_write(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('owner','admin','leadership','project_lead','client_support','team_member','member'))
$$;

create or replace function private.steward_is_admin(org uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.organization_memberships m
    where m.organization_id = org and m.user_id = auth.uid() and m.status = 'active'
      and m.role in ('owner','admin'))
$$;

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

-- Read-only to active org members. ALL writes go through the functions
-- below; there are no insert/update/delete policies, so direct table writes
-- are denied even if table grants are added later.
create policy steward_canonical_runs_select on public.steward_canonical_runs
  for select to authenticated using (private.steward_is_active_member(organization_id));

-- Resolve a selected input ref to its CURRENT stored content. Returns no
-- row when the input does not exist, is outside the org, or is inaccessible
-- to the caller (personal tasks are only visible to their owner).
create or replace function public.steward_resolve_input(p_org uuid, p_kind text, p_id uuid)
returns table(content text, revision integer)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if p_kind = 'transcript' then
    return query select c.transcript_text, c.transcript_revision
      from public.steward_conversations c
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
-- (after reauthorizing the current caller); same operation + changed
-- payload conflicts; a new operation UUID is a deliberate rerun.
create or replace function public.steward_request_canonical_run(
  p_org uuid,
  p_task uuid,
  p_action text,
  p_operation uuid,
  p_input_refs jsonb -- [{kind, id}] — content is resolved server-side
) returns public.steward_canonical_runs
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
  select * into task from public.steward_tasks where id = p_task and organization_id = p_org;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  -- NULL-safe authority: creator, current owner, or org admin.
  if task.created_by is distinct from actor
     and task.owner_user_id is distinct from actor
     and not private.steward_is_admin(p_org) then
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
    return existing; -- replay after reauthorization above
  end if;

  insert into public.steward_canonical_runs
    (organization_id, task_id, action, client_operation_id, request_digest, input_snapshot, requested_by)
  values (p_org, p_task, p_action, p_operation, digest, snapshot, actor)
  returning * into inserted;
  return inserted;
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

-- Claim a run. Returns the row WITH the fresh fencing token; a concurrent
-- or stale claim gets no row.
create or replace function public.steward_claim_canonical_run(
  p_run uuid,
  p_lease_seconds integer default 300
) returns public.steward_canonical_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  run public.steward_canonical_runs;
begin
  if actor is null then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  select * into run from public.steward_canonical_runs where id = p_run for update;
  if not found or not private.steward_can_write(run.organization_id) or run.requested_by <> actor then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  -- Exhausted attempts terminally fail (actor-scoped).
  update public.steward_canonical_runs
     set status = 'failed', failure_reason = 'attempts exhausted', updated_at = now()
   where id = p_run and requested_by = actor
     and status in ('queued','running') and attempts >= max_attempts;
  update public.steward_canonical_runs
     set status = 'running', attempts = attempts + 1,
         claim_token = gen_random_uuid(), claim_version = claim_version + 1,
         lease_expires_at = now() + make_interval(secs => p_lease_seconds),
         updated_at = now()
   where id = p_run and requested_by = actor
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
  actor uuid := auth.uid();
  run public.steward_canonical_runs;
begin
  if actor is null then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_artifact is null or char_length(p_artifact) = 0 then
    raise exception 'artifact_required' using errcode = 'P0422';
  end if;
  update public.steward_canonical_runs
     set status = 'complete', artifact_text = p_artifact,
         artifact_digest = encode(sha256(convert_to(p_artifact, 'utf8')), 'hex'),
         evidence_refs = coalesce(p_evidence_refs, '[]'::jsonb),
         claim_token = null, lease_expires_at = null, updated_at = now()
   where id = p_run and requested_by = actor
     and status = 'running' and claim_token = p_claim_token
     and lease_expires_at > now()
  returning * into run;
  if not found then
    raise exception 'claim_lost' using errcode = 'P0409';
  end if;
  return run;
end;
$$;

-- Fail a run with the same fencing rules. Requeues while attempts remain,
-- terminally fails at the attempt budget.
create or replace function public.steward_fail_canonical_run(
  p_run uuid,
  p_claim_token uuid,
  p_reason text
) returns public.steward_canonical_runs
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  run public.steward_canonical_runs;
begin
  if actor is null then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  update public.steward_canonical_runs
     set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
         failure_reason = left(coalesce(p_reason, ''), 500),
         claim_token = null, lease_expires_at = null, updated_at = now()
   where id = p_run and requested_by = actor
     and status = 'running' and claim_token = p_claim_token
  returning * into run;
  if not found then
    raise exception 'claim_lost' using errcode = 'P0409';
  end if;
  return run;
end;
$$;
