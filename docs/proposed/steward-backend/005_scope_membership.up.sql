-- PROPOSED, UNAPPLIED. Durable required-work scope membership.
-- The required-work denominator is a durable, explicit record — not a
-- derivation from links or archives. Archiving a task NEVER removes it
-- from the denominator. Removal happens only through an explicit audited
-- amendment, which bumps the scope version (invalidating coverage/100) in
-- the same transaction. Hard deletion of scope items is disabled.
-- Verification credit is revision-bound: the task's LATEST receipt must be
-- a verify whose recorded task_revision_after still matches the task's
-- current revision, and the task must still be complete. A legacy status
-- flip after a reopen changes the revision and cannot regain credit.
-- Pending (unlinked, undismissed) ledger proposals gate any 100.

create table if not exists public.steward_scope_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
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
  kind text not null check (kind in ('add','amend_remove','amend_reinstate')),
  reason text,
  -- Append-only operation identity: every mutation carries its client
  -- operation UUID and payload digest so a retry replays and a changed
  -- payload conflicts — amendments can never silently repeat.
  operation_id uuid not null,
  request_digest text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, operation_id)
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
-- the functions (which set a transaction-local flag).
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
-- digest-bound; bumps scope version + supersedes coverage. Pilot scope:
-- business-visibility tasks only.
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
  -- The FK only proves the conversation EXISTS; it must belong to this
  -- org, or a member could scope tasks into a foreign meeting.
  if not exists (select 1 from public.conversations
                 where id = p_conversation and organization_id = p_org) then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;

  -- Reauthorize the scoped task FIRST, before any replay.
  select * into task from public.steward_tasks
    where id = p_task and organization_id = p_org for update;
  if not found then
    raise exception 'task_not_found' using errcode = 'P0404';
  end if;
  if task.task_visibility is distinct from 'business' then
    raise exception 'personal_tasks_out_of_scope' using errcode = 'P0401';
  end if;
  if not private.steward_user_has_task_authority(task, actor) then
    raise exception 'not_authorized' using errcode = 'P0401';
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
    (organization_id, conversation_id, scope_item_id, kind, operation_id, request_digest, actor_id)
  values (p_org, p_conversation, item.id, 'add', p_operation, digest, actor);

  perform private.steward_invalidate_scope(p_org, p_conversation);

  return item;
end;
$$;

-- Seed scope from EXISTING canonical state: required-manual board tasks
-- carry the immutable correlation key written by the workroom
-- add-required-task flow: "cmd-meeting-required:v1:<meetingUUID>:<opUUID>"
-- (see src/domain/steward-required-work.ts — REQUIRED_WORK_PREFIX). This
-- reconciliation is explicit, audited and idempotent — it never creates
-- or edits tasks. Confirmed transcript commitments enter the denominator
-- directly in steward_scope_counts below (they are canonical obligations
-- already, keyed by conversation_id); the proposal ledger tracks the
-- still-unconfirmed remainder.
create or replace function public.steward_scope_sync_required(
  p_org uuid,
  p_conversation uuid,
  p_operation uuid
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  task record;
  item public.steward_scope_items;
  added integer := 0;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if not exists (select 1 from public.conversations
                 where id = p_conversation and organization_id = p_org) then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;
  for task in
    select t.id from public.steward_tasks t
     where t.organization_id = p_org
       and t.task_visibility = 'business'
       and t.correlation_id is not null
       -- Exact repo format: cmd-meeting-required:v1:<meetingUUID>:<opUUID>
       -- (see src/domain/steward-required-work.ts). Four parts exactly,
       -- both trailing parts valid UUIDs — a malformed key never matches.
       and t.correlation_id ~ '^cmd-meeting-required:v1:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       and split_part(t.correlation_id, ':', 3) = p_conversation::text
  loop
    begin
      item := public.steward_scope_add_item(
        p_org, p_conversation, task.id, 'manual_required',
        -- Deterministic per-task operation derived from the sync operation,
        -- so a retried sync replays instead of duplicating.
        uuid_generate_v5('6ba7b810-9dad-11d1-80b4-00c04fd430c8'::uuid,
                         p_operation::text || ':' || task.id::text));
      added := added + 1;
    exception
      when sqlstate 'P0030' then null; -- already in scope: idempotent
    end;
  end loop;
  return added;
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

  -- Canonical task authority FIRST — before any replay — so an ownership
  -- or role change since the original call cannot be bypassed by
  -- resubmitting the same operation UUID. Same rule as add/link/verify:
  -- business task + creator/current owner/admin + active writer.
  select * into item from public.steward_scope_items
    where id = p_item and organization_id = p_org and conversation_id = p_conversation
  for update;
  if not found then
    raise exception 'scope_item_not_found' using errcode = 'P0404';
  end if;
  declare
    task public.steward_tasks;
  begin
    select * into task from public.steward_tasks
      where id = item.task_id and organization_id = p_org;
    if not found then
      raise exception 'task_not_found' using errcode = 'P0404';
    end if;
    if task.task_visibility is distinct from 'business' then
      raise exception 'personal_tasks_out_of_scope' using errcode = 'P0401';
    end if;
    if not private.steward_user_has_task_authority(task, actor) then
      raise exception 'not_authorized' using errcode = 'P0401';
    end if;
  end;

  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'conversation', p_conversation, 'item', p_item,
    'reason', p_reason, 'actor', actor)::text, 'utf8')), 'hex');

  -- Operation replay is bound to the append-only audit trail: the same
  -- operation UUID + same payload returns the already-amended item; the
  -- same UUID with a changed payload conflicts. Without this a retried
  -- removal would hit 'already_removed' instead of replaying. Replay
  -- happens only AFTER the authority reauthorization above.
  declare
    prior public.steward_scope_audit;
  begin
    select * into prior from public.steward_scope_audit
      where organization_id = p_org and operation_id = p_operation;
    if found then
      if prior.request_digest is distinct from digest then
        raise exception 'operation_conflict' using errcode = 'P0002';
      end if;
      select * into existing from public.steward_scope_items
        where id = prior.scope_item_id;
      return existing;
    end if;
  end;

  if item.removed_at is not null then
    raise exception 'already_removed' using errcode = 'P0030';
  end if;

  perform set_config('steward.scope_mutation', 'on', true);
  update public.steward_scope_items
     set removed_at = now(), removal_reason = p_reason
   where id = p_item
  returning * into item;

  insert into public.steward_scope_audit
    (organization_id, conversation_id, scope_item_id, kind, reason, operation_id, request_digest, actor_id)
  values (p_org, p_conversation, item.id, 'amend_remove', p_reason, p_operation, digest, actor);

  perform private.steward_invalidate_scope(p_org, p_conversation);

  return item;
end;
$$;

-- Honest counts from ONE snapshot query (partial reads impossible):
--  denominator: scope items not explicitly removed, INCLUDING items whose
--    task is archived, PLUS confirmed transcript commitments for this
--    conversation (canonical obligations already, keyed by
--    commitments.conversation_id). A commitment is excluded only when its
--    ledger proposal is linked to a task that is itself in scope — that
--    task already carries the obligation, so counting both would double
--    count. Commitment rows NEVER receive verified credit here: no
--    evidence-backed verification contract exists for them yet, so they
--    hold the denominator open until one does.
--  verified: scope items whose task is complete AND whose LATEST receipt
--    is a verify whose recorded task_revision_after still equals the
--    task's current revision. A reopen, an edit, or a legacy status flip
--    after reopen changes the revision and drops the credit.
--  pending_proposals: ledger proposals neither linked nor dismissed —
--    any nonzero value gates 100.
create or replace function public.steward_scope_counts(
  p_org uuid,
  p_conversation uuid
) returns table(denominator integer, verified integer, pending_proposals integer)
language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if auth.uid() is null or not private.steward_is_active_member(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  return query
    select (count(*)::integer
            + (select count(*)::integer from public.commitments cm
                where cm.organization_id = p_org
                  and cm.conversation_id = p_conversation
                  and cm.source_app = 'steward'
                  and cm.status is distinct from 'cancelled'
                  and not exists (
                    select 1 from public.steward_proposal_ledger pl
                    join public.steward_proposal_links lk
                      on lk.proposal_ledger_id = pl.id
                    join public.steward_scope_items si
                      on si.task_id = lk.task_id and si.removed_at is null
                     and si.organization_id = p_org
                     and si.conversation_id = p_conversation
                    where pl.organization_id = p_org
                      and pl.conversation_id = p_conversation
                      and pl.source_key = cm.source_key))),
           count(*) filter (
             where t.status = 'complete'
               and exists (
                 select 1 from public.steward_task_receipts r
                  where r.task_id = i.task_id and r.kind = 'verify'
                    and r.task_revision_after = t.revision
                    and not exists (
                      select 1 from public.steward_task_receipts newer
                       where newer.task_id = i.task_id
                         and newer.created_at > r.created_at)))::integer,
           (select count(*)::integer from public.steward_proposal_ledger pl
             where pl.organization_id = p_org
               and pl.conversation_id = p_conversation
               and pl.status = 'proposed')
      from public.steward_scope_items i
      join public.steward_tasks t on t.id = i.task_id
      where i.organization_id = p_org
       and i.conversation_id = p_conversation
       and i.removed_at is null;
end;
$$;

-- Explicit audited REINSTATEMENT of a removed scope item. Never silent:
-- a removed item stays out of the denominator (and blocks proposal
-- linking via 004) until a human deliberately reinstates it with a
-- substantive reason. Idempotent per operation: a replay returns the
-- already-reinstated item; the same UUID with a changed payload
-- conflicts. Bumps the scope version, invalidating coverage, in the same
-- transaction.
create or replace function public.steward_scope_amend_reinstate(
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

  -- Canonical task authority FIRST — before any replay — identical to
  -- amend_remove: business task + creator/current owner/admin + active
  -- writer. An unrelated active member MUST NOT reinstate another
  -- member's scoped task, and a replay must reauthorize.
  select * into item from public.steward_scope_items
    where id = p_item and organization_id = p_org and conversation_id = p_conversation
  for update;
  if not found then
    raise exception 'scope_item_not_found' using errcode = 'P0404';
  end if;
  declare
    task public.steward_tasks;
  begin
    select * into task from public.steward_tasks
      where id = item.task_id and organization_id = p_org;
    if not found then
      raise exception 'task_not_found' using errcode = 'P0404';
    end if;
    if task.task_visibility is distinct from 'business' then
      raise exception 'personal_tasks_out_of_scope' using errcode = 'P0401';
    end if;
    if not private.steward_user_has_task_authority(task, actor) then
      raise exception 'not_authorized' using errcode = 'P0401';
    end if;
  end;

  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'conversation', p_conversation, 'item', p_item,
    'reinstate_reason', p_reason, 'actor', actor)::text, 'utf8')), 'hex');

  -- Operation replay bound to the append-only audit trail, exactly like
  -- amend_remove: same UUID + same payload replays; changed payload
  -- conflicts. Replay happens only AFTER the authority reauthorization.
  declare
    prior public.steward_scope_audit;
  begin
    select * into prior from public.steward_scope_audit
      where organization_id = p_org and operation_id = p_operation;
    if found then
      if prior.request_digest is distinct from digest then
        raise exception 'operation_conflict' using errcode = 'P0002';
      end if;
      select * into existing from public.steward_scope_items
        where id = prior.scope_item_id;
      return existing;
    end if;
  end;

  if item.removed_at is null then
    raise exception 'not_removed' using errcode = 'P0030';
  end if;

  perform set_config('steward.scope_mutation', 'on', true);
  update public.steward_scope_items
     set removed_at = null, removal_reason = null
    where id = p_item
  returning * into item;

  insert into public.steward_scope_audit
    (organization_id, conversation_id, scope_item_id, kind, reason, operation_id, request_digest, actor_id)
  values (p_org, p_conversation, item.id, 'amend_reinstate', p_reason, p_operation, digest, actor);

  perform private.steward_invalidate_scope(p_org, p_conversation);

  return item;
end;
$$;

revoke all on function public.steward_scope_add_item(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.steward_scope_sync_required(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.steward_scope_amend_reinstate(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.steward_scope_counts(uuid, uuid) from public, anon, authenticated;
revoke all on function public.steward_block_scope_delete() from public, anon, authenticated;
revoke all on function public.steward_guard_scope_update() from public, anon, authenticated;
