-- PROPOSED, UNAPPLIED. Explicit human proposal→existing-task linking.
-- The proposal must exist in the SAME conversation and org; the task must
-- exist in the org and the caller must hold task authority. Linking is an
-- explicit scope change: it durably bumps the conversation's scope version
-- and supersedes coverage in the same transaction, so a link can never
-- silently preserve a 100. Never creates a task or commitment.

create table if not exists public.steward_proposal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  proposal_id uuid not null references public.steward_proposals(id) on delete restrict,
  task_id uuid not null references public.steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  -- sha256 over org + conversation + proposal + task + actor.
  request_digest text not null,
  actor_id uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, proposal_id),
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
  p_proposal uuid,
  p_task uuid,
  p_operation uuid
) returns public.steward_proposal_links
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  proposal public.steward_proposals;
  task public.steward_tasks;
  digest text;
  existing public.steward_proposal_links;
  link public.steward_proposal_links;
begin
  if actor is null or not private.steward_can_write(p_org) then
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
    return existing; -- idempotent replay after reauthorization
  end if;

  -- Proposal must exist in this exact conversation and org.
  select * into proposal from public.steward_proposals
    where id = p_proposal and organization_id = p_org and conversation_id = p_conversation;
  if not found then
    raise exception 'proposal_not_found' using errcode = 'P0404';
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

  -- A proposal already linked by a different operation conflicts; linking
  -- never creates a duplicate task or commitment.
  select * into existing from public.steward_proposal_links
    where organization_id = p_org and proposal_id = p_proposal;
  if found then
    raise exception 'proposal_already_linked' using errcode = 'P0030';
  end if;

  insert into public.steward_proposal_links
    (organization_id, conversation_id, proposal_id, task_id, operation_id, request_digest, actor_id)
  values (p_org, p_conversation, p_proposal, p_task, p_operation, digest, actor)
  returning * into link;

  -- Durable explicit scope change: bump the scope version and supersede
  -- coverage for this conversation in the same transaction.
  insert into public.steward_scope_versions (organization_id, conversation_id, version, updated_at)
  values (p_org, p_conversation, 2, now())
  on conflict (organization_id, conversation_id)
  do update set version = public.steward_scope_versions.version + 1, updated_at = now();

  perform set_config('steward.coverage_mutation', 'on', true);
  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;

  return link;
end;
$$;
