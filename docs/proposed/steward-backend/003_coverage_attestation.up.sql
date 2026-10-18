-- PROPOSED, UNAPPLIED. Durable transcript-coverage attestation.
-- Uses the REAL public.conversations contract (docs/steward-v1-schema.sql):
-- transcript is jsonb (NormalizedConversation); there is no stored hash or
-- revision column. The transcript hash is DERIVED SERVER-SIDE as sha256
-- over the canonical jsonb text (jsonb normalizes key order, so equal
-- transcripts hash equally); callers never supply a hash or version.
-- Validity compares the latest non-superseded attestation against the
-- CURRENT stored hash and durable scope version; any transcript edit,
-- proposal-ledger change, link or scope amendment invalidates it.

-- Durable scope version source. Bumped only by explicit, audited scope
-- changes (proposal ledger changes, links, scope add/amend in 004/005).
create table if not exists public.steward_scope_versions (
  organization_id uuid not null,
  conversation_id uuid not null references public.conversations(id) on delete restrict,
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
  conversation_id uuid not null references public.conversations(id) on delete restrict,
  transcript_hash text not null,
  scope_version integer not null,
  attested_by uuid not null,
  attested_at timestamptz not null default now(),
  superseded_at timestamptz,
  -- Append-only operation identity: the client operation UUID + payload
  -- digest make an uncertain-transport retry replay the SAME attestation
  -- instead of attesting a newer, unreviewed transcript.
  operation_id uuid,
  request_digest text,
  unique (organization_id, operation_id)
);

create index if not exists steward_coverage_attestations_conv_idx
  on public.steward_coverage_attestations (organization_id, conversation_id, attested_at desc);

alter table public.steward_coverage_attestations enable row level security;
create policy steward_coverage_attestations_select on public.steward_coverage_attestations
  for select to authenticated using (private.steward_is_active_member(organization_id));

-- Supersede is allowed only from inside the attestation/scope/link
-- functions, which set the transaction-local flag; every other update or
-- delete is blocked, so clients cannot rewrite or erase attestation history.
create or replace function public.steward_guard_coverage_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if coalesce(current_setting('steward.coverage_mutation', true), '') <> 'on' then
    raise exception 'history_immutable: coverage attestations change only through steward functions'
      using errcode = 'P0403';
  end if;
  return new;
end $$;
drop trigger if exists steward_coverage_immutable on public.steward_coverage_attestations;
create trigger steward_coverage_immutable before update or delete on public.steward_coverage_attestations
  for each row execute function public.steward_guard_coverage_mutation();

-- Server-side hash of the CURRENT stored transcript of a real conversation.
create or replace function private.steward_transcript_hash(p_org uuid, p_conversation uuid)
returns text
language sql stable security definer set search_path = '' as $$
  select encode(sha256(convert_to(c.transcript::text, 'utf8')), 'hex')
    from public.conversations c
   where c.id = p_conversation and c.organization_id = p_org
$$;

-- Shared invalidation: bump the durable scope version and supersede
-- coverage for a conversation in the caller's transaction. Used by the
-- proposal ledger trigger, link and scope functions.
create or replace function private.steward_invalidate_scope(p_org uuid, p_conversation uuid)
returns void
language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into public.steward_scope_versions (organization_id, conversation_id, version, updated_at)
  values (p_org, p_conversation, 2, now())
  on conflict (organization_id, conversation_id)
  do update set version = public.steward_scope_versions.version + 1, updated_at = now();

  perform set_config('steward.coverage_mutation', 'on', true);
  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;
end;
$$;

-- Attest coverage of the source the human ACTUALLY REVIEWED. The caller
-- supplies the transcript hash and scope version it read (from the
-- consistent score snapshot); the function derives the CURRENT stored
-- hash/version itself and REJECTS the attestation when they differ — a
-- transcript or scope change during human review is never silently
-- attested. The client operation UUID + payload digest make an
-- uncertain-transport retry replay the SAME attestation: same operation
-- + same payload returns the recorded row, changed payload conflicts,
-- and a retried operation can never attest a newer, unreviewed source.
create or replace function public.steward_attest_coverage(
  p_org uuid,
  p_conversation uuid,
  p_operation uuid,
  p_expected_hash text,
  p_expected_scope_version integer
) returns public.steward_coverage_attestations
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  conv public.conversations;
  hash text;
  scope_version integer;
  digest text;
  prior public.steward_coverage_attestations;
  a public.steward_coverage_attestations;
begin
  if actor is null or not private.steward_can_write(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if p_operation is null or p_expected_hash is null or p_expected_scope_version is null then
    raise exception 'attestation_binding_required' using errcode = 'P0422';
  end if;
  select * into conv from public.conversations
    where id = p_conversation and organization_id = p_org for update;
  if not found then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;
  if conv.transcript is null or conv.transcript = '{}'::jsonb or conv.transcript = '[]'::jsonb then
    raise exception 'transcript_required' using errcode = 'P0020';
  end if;

  digest := encode(sha256(convert_to(jsonb_build_object(
    'org', p_org, 'conversation', p_conversation, 'hash', p_expected_hash,
    'scopeVersion', p_expected_scope_version, 'actor', actor)::text, 'utf8')), 'hex');

  -- Operation replay BEFORE any state change: the same operation UUID
  -- with the same reviewed source replays the recorded attestation; the
  -- same UUID with a changed payload conflicts.
  select * into prior from public.steward_coverage_attestations
    where organization_id = p_org and operation_id = p_operation;
  if found then
    if prior.request_digest is distinct from digest then
      raise exception 'operation_conflict' using errcode = 'P0002';
    end if;
    return prior;
  end if;

  hash := private.steward_transcript_hash(p_org, p_conversation);
  select version into scope_version from public.steward_scope_versions
    where organization_id = p_org and conversation_id = p_conversation;
  scope_version := coalesce(scope_version, 1);

  -- Fail closed on drift: the source changed while the human reviewed.
  if hash is distinct from p_expected_hash
     or scope_version is distinct from p_expected_scope_version then
    raise exception 'source_changed_since_review' using errcode = 'P0001';
  end if;

  perform set_config('steward.coverage_mutation', 'on', true);
  update public.steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org and conversation_id = p_conversation
     and superseded_at is null;

  insert into public.steward_coverage_attestations
    (organization_id, conversation_id, transcript_hash, scope_version, attested_by,
     operation_id, request_digest)
  values (p_org, p_conversation, hash, scope_version, actor, p_operation, digest)
  returning * into a;
  return a;
end;
$$;

-- Valid coverage = latest non-superseded attestation matches the CURRENT
-- stored transcript hash AND durable scope version. Anything else is
-- unconfirmed. A transcript edit changes the derived hash; any scope
-- change bumps the version; both invalidate.
create or replace function public.steward_current_coverage(
  p_org uuid,
  p_conversation uuid
) returns boolean
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  hash text;
  scope_version integer;
  a public.steward_coverage_attestations;
begin
  if actor is null or not private.steward_is_active_member(p_org) then
    return false;
  end if;
  hash := private.steward_transcript_hash(p_org, p_conversation);
  if hash is null then
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
  return a.transcript_hash = hash and a.scope_version = scope_version;
end;
$$;

revoke all on function public.steward_attest_coverage(uuid, uuid, uuid, text, integer) from public, anon, authenticated;
revoke all on function public.steward_current_coverage(uuid, uuid) from public, anon, authenticated;
revoke all on function public.steward_guard_coverage_mutation() from public, anon, authenticated;
revoke all on function private.steward_transcript_hash(uuid, uuid) from public, anon, authenticated;
revoke all on function private.steward_invalidate_scope(uuid, uuid) from public, anon, authenticated;
