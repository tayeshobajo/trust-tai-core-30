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
  -- Exact evidence refs (segment/action-item pointers) the extractor
  -- produced against the stored source, retained for human review.
  evidence jsonb not null default '[]'::jsonb,
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

-- Append-only decision audit: every registration and dismissal persists
-- its reason, actor, client operation UUID and payload digest. Retries
-- replay; changed payloads conflict; history cannot be rewritten.
create table if not exists public.steward_proposal_decisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  proposal_ledger_id uuid references public.steward_proposal_ledger(id) on delete restrict,
  kind text not null check (kind in ('register','dismiss')),
  reason text,
  operation_id uuid not null,
  request_digest text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, operation_id)
);

alter table public.steward_proposal_decisions enable row level security;
create policy steward_proposal_decisions_select on public.steward_proposal_decisions
  for select to authenticated using (private.steward_is_active_member(organization_id));
drop trigger if exists steward_proposal_decisions_immutable on public.steward_proposal_decisions;
create trigger steward_proposal_decisions_immutable before update or delete
  on public.steward_proposal_decisions
  for each row execute function public.steward_block_history_mutation();

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

  -- A link is a human confirmation of the obligation: the linked task
  -- enters the required-scope denominator ATOMICALLY in this same
  -- transaction, so a proposal can never be marked linked while its
  -- obligation silently stays out of the score. Idempotent on
  -- (org, conversation, task): an existing scope row is kept, never
  -- duplicated, and a replay of this operation returns above before
  -- reaching this point.
  perform set_config('steward.scope_mutation', 'on', true);
  insert into public.steward_scope_items
    (organization_id, conversation_id, task_id, classification, operation_id, request_digest, added_by)
  values (p_org, p_conversation, p_task, 'transcript', p_operation, digest, actor)
  on conflict (organization_id, conversation_id, task_id) do nothing;
  if found then
    insert into public.steward_scope_audit
      (organization_id, conversation_id, scope_item_id, kind, reason, operation_id, request_digest, actor_id)
    select p_org, p_conversation, si.id, 'add', 'confirmed by proposal link', p_operation, digest, actor
      from public.steward_scope_items si
     where si.organization_id = p_org and si.conversation_id = p_conversation and si.task_id = p_task
    on conflict (organization_id, operation_id) do nothing;
  end if;

  return link;
end;
$$;

-- Register extraction output into the ledger. Called by the reviewed
-- extraction path with the proposals derived from the transcript the
-- caller READ; that transcript is compared semantically (jsonb equality)
-- against the stored conversation, so a stale extraction can never
-- overwrite a newer read. Idempotent per (org, conversation, source_key):
-- re-extraction of the same transcript upserts the same rows and never
-- resets a human's linked/dismissed decision. New rows invalidate scope
-- via the ledger trigger. Model suggestions are NEVER auto-confirmed —
-- rows start 'proposed' and only a human link/dismiss changes that.
create or replace function public.steward_register_proposals(
  p_org uuid,
  p_conversation uuid,
  p_operation uuid,
  p_proposals jsonb, -- [{source_key, kind, statement, evidence}]
  p_transcript jsonb -- the exact transcript the extraction ran over
) returns integer
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  conv public.conversations;
  proposal jsonb;
  added integer := 0;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  select * into conv from public.conversations
    where id = p_conversation and organization_id = p_org;
  if not found then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;
  if p_transcript is distinct from conv.transcript then
    raise exception 'transcript_changed' using errcode = 'P0001';
  end if;
  if p_proposals is null or jsonb_typeof(p_proposals) <> 'array' then
    raise exception 'proposals_invalid' using errcode = 'P0422';
  end if;

  -- Operation replay bound to the append-only decision audit: same
  -- operation + same payload replays (0 new rows), changed payload
  -- conflicts.
  declare
    digest text := encode(sha256(convert_to(jsonb_build_object(
      'org', p_org, 'conversation', p_conversation,
      'proposals', p_proposals, 'actor', actor)::text, 'utf8')), 'hex');
    prior public.steward_proposal_decisions;
  begin
    select * into prior from public.steward_proposal_decisions
      where organization_id = p_org and operation_id = p_operation;
    if found then
      if prior.request_digest is distinct from digest then
        raise exception 'operation_conflict' using errcode = 'P0002';
      end if;
      return 0; -- replay: registration already recorded
    end if;
    insert into public.steward_proposal_decisions
      (organization_id, conversation_id, kind, operation_id, request_digest, actor_id)
    values (p_org, p_conversation, 'register', p_operation, digest, actor);
  end;

  for proposal in select * from jsonb_array_elements(p_proposals) loop
    if proposal->>'source_key' is null or proposal->>'statement' is null then
      raise exception 'proposals_invalid' using errcode = 'P0422';
    end if;
    insert into public.steward_proposal_ledger
      (organization_id, conversation_id, source_key, kind, statement, evidence)
    values (p_org, p_conversation, proposal->>'source_key',
            coalesce(proposal->>'kind', 'action'), proposal->>'statement',
            coalesce(proposal->'evidence', '[]'::jsonb))
    on conflict (organization_id, conversation_id, source_key) do nothing;
    if found then added := added + 1; end if;
  end loop;
  return added;
end;
$$;

-- Explicit human dismissal of a ledger proposal, with a substantive
-- reason. Idempotent; the ledger trigger invalidates scope in the same
-- transaction. Never deletes the row.
create or replace function public.steward_dismiss_proposal(
  p_org uuid,
  p_conversation uuid,
  p_proposal uuid,
  p_reason text,
  p_operation uuid
) returns public.steward_proposal_ledger
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  proposal public.steward_proposal_ledger;
  digest text;
  prior public.steward_proposal_decisions;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_reason is null or char_length(btrim(p_reason)) < 10 then
    raise exception 'reason_required' using errcode = 'P0010';
  end if;
  -- Operation replay bound to the append-only decision audit BEFORE any
  -- state read: same operation + same payload replays the recorded
  -- dismissal; changed payload conflicts.
  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'proposal', p_proposal, 'reason', p_reason,
    'actor', actor)::text, 'utf8')), 'hex');
  begin
    select * into prior from public.steward_proposal_decisions
      where organization_id = p_org and operation_id = p_operation;
    if found then
      if prior.request_digest is distinct from digest then
        raise exception 'operation_conflict' using errcode = 'P0002';
      end if;
      select * into proposal from public.steward_proposal_ledger
        where id = prior.proposal_ledger_id;
      return proposal;
    end if;
  end;

  -- Row lock: concurrent dismiss/link decisions serialize here.
  select * into proposal from public.steward_proposal_ledger
    where id = p_proposal and organization_id = p_org and conversation_id = p_conversation
    for update;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0404';
  end if;
  if proposal.status = 'linked' then
    raise exception 'proposal_already_linked' using errcode = 'P0030';
  end if;
  if proposal.status = 'dismissed' then
    return proposal; -- idempotent: already dismissed by another operation
  end if;
  update public.steward_proposal_ledger set status = 'dismissed' where id = p_proposal
  returning * into proposal;
  insert into public.steward_proposal_decisions
    (organization_id, conversation_id, proposal_ledger_id, kind, reason,
     operation_id, request_digest, actor_id)
  values (p_org, p_conversation, p_proposal, 'dismiss', p_reason,
          p_operation, digest, actor);
  return proposal;
end;
$$;

revoke all on function public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.steward_register_proposals(uuid, uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.steward_dismiss_proposal(uuid, uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.steward_proposal_ledger_invalidate() from public, anon, authenticated;
