-- PROPOSED, UNAPPLIED. Explicit human decision linking a reviewed proposal to
-- an existing canonical task. Never creates a task or commitment; never
-- duplicates. One canonical link per proposal; replaying the same operation
-- returns the existing link. Recording a link supersedes coverage for the
-- proposal's conversation (scope review invalidation).
--
-- Access note: execute grant to `authenticated` is REQUIRED but UNRESOLVED —
-- see README.md. Only revokes are applied here.

create table if not exists steward_proposal_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  proposal_id uuid not null,
  task_id uuid not null references steward_tasks(id) on delete restrict,
  operation_id uuid not null,
  decided_by uuid not null,
  created_at timestamptz not null default now(),
  unique (organization_id, proposal_id),
  unique (organization_id, operation_id)
);

create or replace function steward_link_proposal(
  p_org uuid,
  p_conversation uuid,
  p_proposal uuid,
  p_task uuid,
  p_operation uuid,
  p_actor uuid
) returns steward_proposal_links
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  existing steward_proposal_links;
  link steward_proposal_links;
  t steward_tasks;
begin
  -- Idempotent replay of the same operation.
  select * into existing from steward_proposal_links
   where organization_id = p_org and operation_id = p_operation;
  if found then
    return existing;
  end if;

  -- One canonical link per proposal: a different operation for an already
  -- linked proposal is a conflict, never a silent second link.
  select * into existing from steward_proposal_links
   where organization_id = p_org and proposal_id = p_proposal;
  if found then
    raise exception 'proposal_already_linked: proposal % is linked to task %', p_proposal, existing.task_id
      using errcode = 'P0030';
  end if;

  -- The target must be an existing task in the same org. Linking never
  -- creates a task or a commitment.
  select * into t from steward_tasks
   where id = p_task and organization_id = p_org for share;
  if not found then
    raise exception 'task_not_found_or_inaccessible' using errcode = 'P0003';
  end if;

  insert into steward_proposal_links
    (organization_id, conversation_id, proposal_id, task_id, operation_id, decided_by)
  values (p_org, p_conversation, p_proposal, p_task, p_operation, p_actor)
  returning * into link;

  -- Scope changed by human decision: any current coverage attestation for
  -- this conversation is superseded, so 100 cannot survive a scope change.
  update steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org
     and conversation_id = p_conversation
     and superseded_at is null;

  return link;
end;
$$;

revoke all on function steward_link_proposal(uuid,uuid,uuid,uuid,uuid,uuid) from public, anon;
