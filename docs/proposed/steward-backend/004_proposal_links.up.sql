-- PROPOSED, UNAPPLIED. Explicit human proposal→existing-task linking.
-- Proposals are NOT a base table in the real schema: extraction derives
-- them and a confirmed proposal becomes a public.commitments row keyed by
-- (organization_id, source_key). This patch adds an ADDITIVE canonical
-- proposal ledger that mirrors that contract: one durable row per
-- (organization_id, conversation_id, source_key), written by the reviewed
-- extraction path, giving proposals a canonical identity to link against.
-- The proposal must exist in the SAME conversation and org; the task must
-- exist in the org and the caller must hold task authority. Linking is an
-- explicit scope change: it durably bumps the conversation's scope version
-- and supersedes coverage in the same transaction. Never creates a task
-- or commitment.

create table if not exists public.steward_proposal_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  -- Stable extraction key, same contract as commitments.source_key.
  source_key text not null,
  kind text not null default 'action',
  statement text not null,
  -- 'proposed' until a human links or dismisses it; pending proposals gate
  -- any 100 (see steward_scope_counts in 005).
  status text not null default 'proposed' check (status in ('proposed','linked','dismissed')),
  created_at timestamptz not null default now(),
  unique (organization_id, conversation_id, source_key)
);

alter table public.steward_proposal_ledger enable row level security;
create policy steward_proposal_ledger_select on public.steward_proposal_ledger
  for select to authenticated using (private.steward_is_active_member(organization_id));

-- Ledger writes change the scope basis: any insert or status change bumps
-- the durable scope version and supersedes coverage in the same
-- transaction, so a re-extraction can never silently preserve a 100.
create or replace function public.steward_proposal_ledger_invalidate() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform private.steward_invalidate_scope(
    coalesce(new.organization_id, old.organization_id),
    coalesce(new.conversation_id, old.conversation_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists steward_proposal_ledger_invalidate on public.steward_proposal_ledger;
create trigger steward_proposal_ledger_invalidate after insert or update or delete
  on public.steward_proposal_ledger
  for each row execute function public.steward_proposal_ledger_invalidate();

create table if not exists public.steward_proposal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  proposal_ledger_id uuid not null references public.steward_proposal_ledger(id) on delete restrict,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  -- sha256 over org + conversation + proposal + task + actor.
  request_digest text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, proposal_ledger_id),
  unique (organization_id, operation_id)
);

alter table public.steward_proposal_links enable row level security;
create policy steward_proposal_links_select on public.steward_proposal_links
  for select to authenticated using (private.steward_is_active_member(organization_id));

drop trigger if exists steward_proposal_links_immutable on public.steward_proposal_links;
create trigger steward_proposal_links_immutable before update or delete on public.steward_proposal_links
  for each row execute function public.steward_block_history_mutation();

create or replace function public.steward_link_proposal(
  p_org uuid,
  p_conversation uuid,
  p_proposal uuid, -- steward_proposal_ledger.id
  p_task uuid,
  p_operation uuid
) returns public.steward_proposal_links
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  proposal public.steward_proposal_ledger;
  task public.steward_tasks;
  digest text;
  existing public.steward_proposal_links;
  link public.steward_proposal_links;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
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
    'org', p_org, 'conversation', p_conversation, 'proposal', p_proposal,
    'task', p_task, 'actor', actor)::text, 'utf8')), 'hex');

  select * into existing from public.steward_proposal_links
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if existing.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return existing; -- idempotent replay after full reauthorization
  end if;

  -- Proposal must exist in this exact conversation and org.
  select * into proposal from public.steward_proposal_ledger
    where id = p_proposal and organization_id = p_org and conversation_id = p_conversation;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0404';
  end if;

  -- A proposal already linked by a different operation conflicts; linking
  -- never creates a duplicate task or commitment.
  select * into existing from public.steward_proposal_links
    where organization_id = p_org and proposal_ledger_id = p_proposal;
  if found then
    raise exception 'proposal_already_linked' using errcode = 'P0030';
  end if;

  insert into public.steward_proposal_links
    (organization_id, conversation_id, proposal_ledger_id, task_id, operation_id, request_digest, actor_id)
  values (p_org, p_conversation, p_proposal, p_task, p_operation, digest, actor)
  returning * into link;

  -- Mark the ledger proposal linked (the ledger trigger bumps the scope
  -- version and supersedes coverage in this same transaction).
  update public.steward_proposal_ledger set status = 'linked' where id = p_proposal;

  return link;
end;
$$;

revoke all on function public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.steward_proposal_ledger_invalidate() from public, anon, authenticated;
