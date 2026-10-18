-- PROPOSED, UNAPPLIED. Atomic evidence-backed verification and reopen.
-- Identity from auth.uid() only; active membership + write role required;
-- task authority (creator / owner / admin) rechecked on every call,
-- including replays. Receipt + audit + status update happen in ONE
-- transaction — any failure rolls back all three. Operation UUIDs are
-- unique across verify AND reopen and bound to a payload digest, so a
-- reused UUID with a different payload conflicts instead of replaying.

create table if not exists public.steward_task_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  kind text not null check (kind in ('verify','reopen')),
  note text not null,
  -- sha256 over org + task + kind + expected_revision + note + actor.
  request_digest text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, operation_id)
);

create table if not exists public.steward_task_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  receipt_id uuid references public.steward_task_receipts(id) on delete restrict,
  kind text not null check (kind in ('verify','reopen')),
  note text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.steward_task_receipts enable row level security;
alter table public.steward_task_audit enable row level security;

create policy steward_task_receipts_select on public.steward_task_receipts
  for select to authenticated using (private.steward_is_active_member(organization_id));
create policy steward_task_audit_select on public.steward_task_audit
  for select to authenticated using (private.steward_is_active_member(organization_id));

-- Append-only enforcement: even a role with table grants cannot update or
-- delete receipts/audit rows. History is immutable by trigger, not by
-- policy alone.
create or replace function public.steward_block_history_mutation() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'history_immutable' using errcode = 'P0405';
end;
$$;

drop trigger if exists steward_receipts_immutable on public.steward_task_receipts;
create trigger steward_receipts_immutable before update or delete on public.steward_task_receipts
  for each row execute function public.steward_block_history_mutation();
drop trigger if exists steward_audit_immutable on public.steward_task_audit;
create trigger steward_audit_immutable before update or delete on public.steward_task_audit
  for each row execute function public.steward_block_history_mutation();

create or replace function public.steward_verify_task(
  p_org uuid,
  p_task uuid,
  p_expected_revision integer,
  p_operation uuid,
  p_note text
) returns public.steward_task_receipts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  task public.steward_tasks;
  digest text;
  existing public.steward_task_receipts;
  receipt public.steward_task_receipts;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_note is null or char_length(btrim(p_note)) < 10 then
    raise exception 'evidence_required' using errcode = 'P0010';
  end if;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'task', p_task, 'kind', 'verify',
    'revision', p_expected_revision, 'note', p_note, 'actor', actor)::text, 'utf8')), 'hex');

  select * into existing from public.steward_task_receipts
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return existing; -- idempotent replay after reauthorization
  end if;

  select * into task from public.steward_tasks where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  if task.created_by is distinct from actor
     and task.owner_user_id is distinct from actor
     and not private.steward_is_admin(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if task.revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;

  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, actor_id)
  values (p_org, p_task, p_operation, 'verify', p_note, digest, actor)
  returning * into receipt;

  insert into public.steward_task_audit
    (organization_id, task_id, receipt_id, kind, note, actor_id)
  values (p_org, p_task, receipt.id, 'verify', p_note, actor);

  update public.steward_tasks
     set status = 'complete', completion_evidence = p_note,
         completed_at = now(), completed_by = actor,
         revision = revision + 1, updated_at = now()
   where id = p_task;
  return receipt;
end;
$$;

create or replace function public.steward_reopen_task(
  p_org uuid,
  p_task uuid,
  p_expected_revision integer,
  p_operation uuid,
  p_reason text
) returns public.steward_task_receipts
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  task public.steward_tasks;
  digest text;
  existing public.steward_task_receipts;
  receipt public.steward_task_receipts;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'evidence_required' using errcode = 'P0010';
  end if;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'task', p_task, 'kind', 'reopen',
    'revision', p_expected_revision, 'note', p_reason, 'actor', actor)::text, 'utf8')), 'hex');

  select * into existing from public.steward_task_receipts
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return existing;
  end if;

  select * into task from public.steward_tasks where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  if task.created_by is distinct from actor
     and task.owner_user_id is distinct from actor
     and not private.steward_is_admin(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if task.revision <> p_expected_revision then
    raise exception 'revision_conflict' using errcode = 'P0001';
  end if;

  insert into public.steward_task_receipts
    (organization_id, task_id, operation_id, kind, note, request_digest, actor_id)
  values (p_org, p_task, p_operation, 'reopen', p_reason, digest, actor)
  returning * into receipt;

  insert into public.steward_task_audit
    (organization_id, task_id, receipt_id, kind, note, actor_id)
  values (p_org, p_task, receipt.id, 'reopen', p_reason, actor);

  -- Reopen keeps prior evidence/completion fields; only status changes.
  update public.steward_tasks
     set status = 'open', revision = revision + 1, updated_at = now()
   where id = p_task;
  return receipt;
end;
$$;
