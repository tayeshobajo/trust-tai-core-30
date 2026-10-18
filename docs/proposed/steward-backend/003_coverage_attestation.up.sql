-- PROPOSED, UNAPPLIED. Durable transcript-coverage attestation.
-- The attestation records the SERVER-READ transcript hash and scope version
-- at attestation time — callers never supply them, so nobody can attest an
-- arbitrary context. Validity is computed by comparing the latest
-- non-superseded attestation against the CURRENT stored conversation hash
-- and scope version; any transcript edit or scope amendment invalidates it.

-- Durable scope version source. Bumped only by explicit, audited scope
-- changes (proposal link, scope add/amend in 004/005).
create table if not exists public.steward_scope_versions (
  organization_id uuid not null,
  conversation_id uuid not null,
  version integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (organization_id, conversation_id)
);

alter table public.steward_scope_versions enable row level security;
create policy steward_scope_versions_select on public.steward_scope_versions
  for select to authenticated using (private.steward_is_active_member(organization_id));

create table if not exists public.steward_coverage_attestations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  conversation_id uuid not null,
  transcript_hash text not null,
  scope_version integer not null,
  attested_by uuid not null,
  attested_at timestamptz not null default now(),
  superseded_at timestamptz
);

create index if not exists steward_coverage_attestations_conv_idx
  on public.steward_coverage_attestations (organization_id, conversation_id, attested_at desc);

alter table public.steward_coverage_attestations enable row level security;
create policy steward_coverage_attestations_select on public.steward_coverage_attestations
  for select to authenticated using (private.steward_is_active_member(organization_id));

drop trigger if exists steward_coverage_immutable on public.steward_coverage_attestations;
create trigger steward_coverage_immutable before update or delete on public.steward_coverage_attestations
  for each row execute function public.steward_block_history_mutation();

-- Attest coverage of the CURRENT stored conversation state. The
-- conversation must exist in the org; hash and version are read from the
-- stored row, never from the caller. Supersedes any prior current
-- attestation in the same transaction.
create or replace function public.steward_attest_coverage(
  p_org uuid,
  p_conversation uuid
) returns public.steward_coverage_attestations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  conv public.steward_conversations;
  scope_version integer;
  a public.steward_coverage_attestations;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  select * into conv from public.steward_conversations
    where id = p_conversation and organization_id = p_org for update;
  if not found then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;
  if conv.transcript_hash is null or char_length(conv.transcript_hash) < 16 then
    raise exception 'transcript_hash_required' using errcode = 'P0020';
  end if;
  select version into scope_version from public.steward_scope_versions
    where organization_id = p_org and conversation_id = p_conversation;
  scope_version := coalesce(scope_version, 1);

  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;

  insert into public.steward_coverage_attestations
    (organization_id, conversation_id, transcript_hash, scope_version, attested_by)
  values (p_org, p_conversation, conv.transcript_hash, scope_version, actor)
  returning * into a;
  return a;
end;
$$;

-- Valid coverage = latest non-superseded attestation matches the CURRENT
-- stored transcript hash AND scope version. Anything else is unconfirmed.
create or replace function public.steward_current_coverage(
  p_org uuid,
  p_conversation uuid
) returns boolean
language plpgsql stable security invoker set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  conv public.steward_conversations;
  scope_version integer;
  a public.steward_coverage_attestations;
begin
  if actor is null or not private.steward_is_active_member(p_org) then
    return false;
  end if;
  select * into conv from public.steward_conversations
    where id = p_conversation and organization_id = p_org;
  if not found then
    return false;
  end if;
  select version into scope_version from public.steward_scope_versions
    where organization_id = p_org and conversation_id = p_conversation;
  scope_version := coalesce(scope_version, 1);
  select * into a from public.steward_coverage_attestations
    where organization_id = p_org and conversation_id = p_conversation
      and superseded_at is null
    order by attested_at desc limit 1;
  if not found then
    return false;
  end if;
  return a.transcript_hash = conv.transcript_hash and a.scope_version = scope_version;
end;
$$;
