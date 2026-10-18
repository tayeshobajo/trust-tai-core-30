-- PROPOSED, UNAPPLIED. Atomic evidence-backed verification and reopen for
-- canonical board tasks. One transaction: row lock + expected revision +
-- evidence + receipt + audit. Any failed write rolls the whole thing back.
-- Reopen retains all prior evidence and history. Never calls the legacy
-- best-effort completeTask path.
--
-- Access note: execute grant to `authenticated` is REQUIRED but UNRESOLVED —
-- see README.md. Only revokes are applied here.

create table if not exists steward_task_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  note text not null check (char_length(btrim(note)) >= 10),
  actor uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, operation_id)
);

create table if not exists steward_task_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  action text not null check (action in ('verify','reopen')),
  actor uuid not null,
  note text not null,
  from_status text not null,
  to_status text not null,
  revision_before integer not null,
  revision_after integer not null,
  created_at timestamptz not null default now()
  -- append-only: no update/delete granted; no trigger needed while grants stay narrow
);

create index if not exists steward_task_audit_task_idx
  on steward_task_audit (organization_id, task_id, created_at);

create or replace function steward_verify_task(
  p_org uuid,
  p_task uuid,
  p_expected_revision integer,
  p_operation uuid,
  p_note text,
  p_actor uuid
) returns steward_task_receipts
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t steward_tasks;
  receipt steward_task_receipts;
begin
  if char_length(btrim(coalesce(p_note, ''))) < 10 then
    raise exception 'evidence_required: a substantive completion note is required' using errcode = 'P0010';
  end if;

  -- Duplicate operation replays the original receipt without new writes.
  select * into receipt from steward_task_receipts
   where organization_id = p_org and operation_id = p_operation;
  if found then
    return receipt;
  end if;

  select * into t from steward_tasks
   where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found_or_inaccessible' using errcode = 'P0003';
  end if;
  if t.revision <> p_expected_revision then
    raise exception 'revision_conflict: expected %, found %', p_expected_revision, t.revision
      using errcode = 'P0011';
  end if;
  if t.created_by <> p_actor and t.owner_user_id <> p_actor then
    raise exception 'not_authorized: only the creator or owner may verify this task' using errcode = 'P0004';
  end if;
  if t.status = 'complete' then
    raise exception 'already_verified' using errcode = 'P0012';
  end if;

  insert into steward_task_receipts (organization_id, task_id, operation_id, note, actor)
  values (p_org, p_task, p_operation, btrim(p_note), p_actor)
  returning * into receipt;

  insert into steward_task_audit
    (organization_id, task_id, operation_id, action, actor, note, from_status, to_status, revision_before, revision_after)
  values
    (p_org, p_task, p_operation, 'verify', p_actor, btrim(p_note), t.status, 'complete', t.revision, t.revision + 1);

  update steward_tasks
     set status = 'complete',
         completion_evidence = btrim(p_note),
         completed_at = now(),
         completed_by = p_actor::text,
         revision = revision + 1,
         updated_at = now()
   where id = p_task and organization_id = p_org and revision = p_expected_revision;

  if not found then
    -- Defensive: the row lock above makes this unreachable, but any failure
    -- here raises and rolls back receipt + audit with the status change.
    raise exception 'revision_conflict' using errcode = 'P0011';
  end if;

  return receipt;
end;
$$;

create or replace function steward_reopen_task(
  p_org uuid,
  p_task uuid,
  p_expected_revision integer,
  p_operation uuid,
  p_reason text,
  p_actor uuid
) returns steward_task_audit
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  t steward_tasks;
  entry steward_task_audit;
begin
  if char_length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'reason_required: a substantive reopen reason is required' using errcode = 'P0010';
  end if;

  select * into entry from steward_task_audit
   where organization_id = p_org and operation_id = p_operation;
  if found then
    return entry; -- duplicate operation replays
  end if;

  select * into t from steward_tasks
   where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found_or_inaccessible' using errcode = 'P0003';
  end if;
  if t.revision <> p_expected_revision then
    raise exception 'revision_conflict: expected %, found %', p_expected_revision, t.revision
      using errcode = 'P0011';
  end if;
  if t.created_by <> p_actor and t.owner_user_id <> p_actor then
    raise exception 'not_authorized' using errcode = 'P0004';
  end if;
  if t.status <> 'complete' then
    raise exception 'not_verified: only a verified task can be reopened' using errcode = 'P0013';
  end if;

  -- Receipts and prior audit rows are retained; reopen appends new history.
  insert into steward_task_audit
    (organization_id, task_id, operation_id, action, actor, note, from_status, to_status, revision_before, revision_after)
  values
    (p_org, p_task, p_operation, 'reopen', p_actor, btrim(p_reason), t.status, 'open', t.revision, t.revision + 1)
  returning * into entry;

  update steward_tasks
     set status = 'open',
         revision = revision + 1,
         updated_at = now()
   where id = p_task and organization_id = p_org and revision = p_expected_revision;

  return entry;
end;
$$;

revoke all on function steward_verify_task(uuid,uuid,integer,uuid,text,uuid) from public, anon;
revoke all on function steward_reopen_task(uuid,uuid,integer,uuid,text,uuid) from public, anon;
