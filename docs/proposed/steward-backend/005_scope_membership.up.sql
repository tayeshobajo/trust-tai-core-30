-- PROPOSED, UNAPPLIED. Durable required-work scope membership.
-- The required-work denominator is a durable, explicit record — not a
-- derivation from links or archives. Archiving a task NEVER removes it from
-- the denominator. Removal happens only through an explicit audited
-- amendment, which bumps the scope version (invalidating coverage/100) in
-- the same transaction. Hard deletion of scope items is disabled.

create table if not exists public.steward_scope_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  classification text not null check (classification in ('transcript','manual_required')),
  operation_id uuid not null,
  request_digest text not null,
  added_by uuid not null,
  added_at timestamptz not null default now(),
  removed_at timestamptz,
  removal_reason text,
  unique (organization_id, conversation_id, task_id),
  unique (organization_id, operation_id)
);

create table if not exists public.steward_scope_audit (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  scope_item_id uuid references public.steward_scope_items(id) on delete restrict,
  kind text not null check (kind in ('add','amend_remove')),
  reason text,
  actor_id uuid not null,
  created_at timestamptz not null default now()
);

alter table public.steward_scope_items enable row level security;
alter table public.steward_scope_audit enable row level security;

create policy steward_scope_items_select on public.steward_scope_items
  for select to authenticated using (private.steward_is_active_member(organization_id));
create policy steward_scope_audit_select on public.steward_scope_audit
  for select to authenticated using (private.steward_is_active_member(organization_id));

-- No delete policy and no delete grant: scope rows cannot disappear. The
-- trigger blocks delete even for privileged roles; amendments set
-- removed_at through the function below only.
create or replace function public.steward_block_scope_delete() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'scope_delete_disabled' using errcode = 'P0405';
end;
$$;

drop trigger if exists steward_scope_items_no_delete on public.steward_scope_items;
create trigger steward_scope_items_no_delete before delete on public.steward_scope_items
  for each row execute function public.steward_block_scope_delete();
drop trigger if exists steward_scope_audit_immutable on public.steward_scope_audit;
create trigger steward_scope_audit_immutable before update or delete on public.steward_scope_audit
  for each row execute function public.steward_block_history_mutation();

-- Direct updates to scope items are blocked; all mutation flows through
-- the functions (which run as the caller and bypass this trigger via a
-- session flag set inside the function transaction).
create or replace function public.steward_guard_scope_update() returns trigger
language plpgsql set search_path = public, pg_temp as $$
begin
  if current_setting('steward.scope_mutation', true) is distinct from 'on' then
    raise exception 'scope_update_via_function_only' using errcode = 'P0405';
  end if;
  return new;
end;
$$;

drop trigger if exists steward_scope_items_guard_update on public.steward_scope_items;
create trigger steward_scope_items_guard_update before update on public.steward_scope_items
  for each row execute function public.steward_guard_scope_update();

-- Add a task to a meeting's required scope. Idempotent per operation;
-- digest-bound; bumps scope version + supersedes coverage.
create or replace function public.steward_scope_add_item(
  p_org uuid,
  p_conversation uuid,
  p_task uuid,
  p_classification text,
  p_operation uuid
) returns public.steward_scope_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  task public.steward_tasks;
  digest text;
  existing public.steward_scope_items;
  item public.steward_scope_items;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_classification not in ('transcript','manual_required') then
    raise exception 'classification_invalid' using errcode = 'P0422';
  end if;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'conversation', p_conversation, 'task', p_task,
    'classification', p_classification, 'actor', actor)::text, 'utf8')), 'hex');

  select * into existing from public.steward_scope_items
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return existing;
  end if;

  select * into task from public.steward_tasks
    where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  if task.created_by is distinct from actor
     and task.owner_user_id is distinct from actor
     and not private.steward_is_admin(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;

  select * into existing from public.steward_scope_items
    where organization_id = p_org and conversation_id = p_conversation and task_id = p_task;
  if found then
    raise exception 'task_already_in_scope' using errcode = 'P0030';
  end if;

  perform set_config('steward.scope_mutation', 'on', true);
  insert into public.steward_scope_items
    (organization_id, conversation_id, task_id, classification, operation_id, request_digest, added_by)
  values (p_org, p_conversation, p_task, p_classification, p_operation, digest, actor)
  returning * into item;

  insert into public.steward_scope_audit
    (organization_id, conversation_id, scope_item_id, kind, actor_id)
  values (p_org, p_conversation, item.id, 'add', actor);

  insert into public.steward_scope_versions (organization_id, conversation_id, version, updated_at)
  values (p_org, p_conversation, 2, now())
  on conflict (organization_id, conversation_id)
  do update set version = public.steward_scope_versions.version + 1, updated_at = now();

  perform set_config('steward.coverage_mutation', 'on', true);
  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;

  return item;
end;
$$;

-- Explicit audited scope amendment (removal). The item stays in the table
-- with removed_at set; the amendment is appended to the audit trail and
-- bumps the scope version, invalidating coverage. Requires a substantive
-- reason.
create or replace function public.steward_scope_amend_remove(
  p_org uuid,
  p_conversation uuid,
  p_item uuid,
  p_reason text,
  p_operation uuid
) returns public.steward_scope_items
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  item public.steward_scope_items;
  digest text;
  existing public.steward_scope_items;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'reason_required' using errcode = 'P0010';
  end if;
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'item', p_item, 'reason', p_reason, 'actor', actor)::text, 'utf8')), 'hex');

  select * into existing from public.steward_scope_items
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return existing;
  end if;

  select * into item from public.steward_scope_items
    where id = p_item and organization_id = p_org and conversation_id = p_conversation
  for update;
  if not found then
    raise exception 'scope_item_not_found' using errcode = 'P0404';
  end if;
  if item.removed_at is not null then
    raise exception 'already_removed' using errcode = 'P0030';
  end if;

  perform set_config('steward.scope_mutation', 'on', true);
  update public.steward_scope_items
     set removed_at = now(), removal_reason = p_reason
   where id = p_item
  returning * into item;

  insert into public.steward_scope_audit
    (organization_id, conversation_id, scope_item_id, kind, reason, actor_id)
  values (p_org, p_conversation, item.id, 'amend_remove', p_reason, actor);

  insert into public.steward_scope_versions (organization_id, conversation_id, version, updated_at)
  values (p_org, p_conversation, 2, now())
  on conflict (organization_id, conversation_id)
  do update set version = public.steward_scope_versions.version + 1, updated_at = now();

  perform set_config('steward.coverage_mutation', 'on', true);
  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;

  return item;
end;
$$;

-- Honest counts: denominator = scope items not explicitly removed,
-- INCLUDING items whose task is archived. Verified = items whose task is
-- complete with a matching verify receipt. Partial reads are impossible:
-- both counts come from the same snapshot query.
create or replace function public.steward_scope_counts(
  p_org uuid,
  p_conversation uuid
) returns table(denominator integer, verified integer)
language plpgsql stable security invoker set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not private.steward_is_active_member(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  return query
    select count(*)::integer,
           count(*) filter (
             where t.status = 'complete'
               and exists (select 1 from public.steward_task_receipts r
                            where r.task_id = i.task_id and r.kind = 'verify'))::integer
      from public.steward_scope_items i
      join public.steward_tasks t on t.id = i.task_id
     where i.organization_id = p_org
       and i.conversation_id = p_conversation
       and i.removed_at is null;
end;
$$;
