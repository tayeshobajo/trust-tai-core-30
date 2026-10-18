-- PROPOSED, UNAPPLIED. Durable transcript-coverage attestation.
-- Coverage is valid only while the latest attestation for a conversation
-- matches BOTH the current transcript hash and the current reviewed scope
-- version. Any transcript edit or scope amendment supersedes it, so a stale
-- attestation can never keep a meeting at 100. No browser-only flags.
--
-- Access note: execute grant to `authenticated` is REQUIRED but UNRESOLVED —
-- see README.md. Only revokes are applied here.

create table if not exists steward_coverage_attestations (
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
  on steward_coverage_attestations (organization_id, conversation_id, attested_at desc);

-- Record a new attestation; any prior current attestation for the
-- conversation is superseded in the same transaction.
create or replace function steward_attest_coverage(
  p_org uuid,
  p_conversation uuid,
  p_transcript_hash text,
  p_scope_version integer,
  p_actor uuid
) returns steward_coverage_attestations
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  a steward_coverage_attestations;
begin
  if char_length(coalesce(p_transcript_hash, '')) < 16 then
    raise exception 'transcript_hash_required' using errcode = 'P0020';
  end if;

  update steward_coverage_attestations
     set superseded_at = now()
   where organization_id = p_org
     and conversation_id = p_conversation
     and superseded_at is null;

  insert into steward_coverage_attestations
    (organization_id, conversation_id, transcript_hash, scope_version, attested_by)
  values (p_org, p_conversation, p_transcript_hash, p_scope_version, p_actor)
  returning * into a;
  return a;
end;
$$;

-- Valid coverage = the latest non-superseded attestation matches the current
-- transcript hash AND scope version. Anything else is "not confirmed".
create or replace function steward_current_coverage(
  p_org uuid,
  p_conversation uuid,
  p_transcript_hash text,
  p_scope_version integer
) returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from steward_coverage_attestations
     where organization_id = p_org
       and conversation_id = p_conversation
       and superseded_at is null
       and transcript_hash = p_transcript_hash
       and scope_version = p_scope_version
  );
$$;

revoke all on function steward_attest_coverage(uuid,uuid,text,integer,uuid) from public, anon;
revoke all on function steward_current_coverage(uuid,uuid,text,integer) from public, anon;
