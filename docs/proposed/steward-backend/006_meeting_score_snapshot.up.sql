-- PROPOSED, UNAPPLIED. Consistent meeting-score snapshot.
-- The workroom score must never be assembled from separate
-- scope/coverage/proposal reads taken at different times: a mixed
-- snapshot can show 100 while one component is stale. This single
-- read-only RPC returns denominator, verified, pending proposals,
-- coverage currency and the source versions in ONE statement snapshot,
-- under the same active-membership access rules as every other reader.
-- SECURITY DEFINER is used only to reuse the existing private helpers;
-- identity and membership are re-validated from auth.uid() inside.

create or replace function public.steward_meeting_score_snapshot(
  p_org uuid,
  p_conversation uuid
) returns jsonb
language plpgsql stable security definer set search_path = public, pg_temp as $$
declare
  actor uuid := auth.uid();
  counts record;
  hash text;
  v_scope_version integer;
  attestation record;
  coverage_current boolean;
begin
  if actor is null or not private.steward_is_active_member(p_org) then
    raise exception 'not_authorized' using errcode = 'P0401';
  end if;
  if not exists (select 1 from public.conversations
                 where id = p_conversation and organization_id = p_org) then
    raise exception 'conversation_not_found' using errcode = 'P0404';
  end if;

  -- One statement snapshot: scope counts, the current transcript hash and
  -- the durable scope version are read together, so the returned numbers
  -- can never disagree with each other.
  select * into counts from public.steward_scope_counts(p_org, p_conversation);
  hash := private.steward_transcript_hash(p_org, p_conversation);
  select version into v_scope_version from public.steward_scope_versions
    where organization_id = p_org and conversation_id = p_conversation;
  v_scope_version := coalesce(v_scope_version, 1);

  select ca.attested_at into attestation
    from public.steward_coverage_attestations ca
   where ca.organization_id = p_org
     and ca.conversation_id = p_conversation
     and ca.superseded_at is null
     and ca.transcript_hash = hash
     and ca.scope_version = v_scope_version
   order by ca.attested_at desc
   limit 1;
  coverage_current := attestation.attested_at is not null;

  return jsonb_build_object(
    'denominator', counts.denominator,
    'verified', counts.verified,
    'pendingProposals', counts.pending_proposals,
    'coverageCurrent', coverage_current,
    'attestedAt', attestation.attested_at,
    'scopeVersion', v_scope_version,
    'complete', counts.denominator > 0
      and counts.verified = counts.denominator
      and counts.pending_proposals = 0
      and coverage_current
  );
end;
$$;

revoke all on function public.steward_meeting_score_snapshot(uuid, uuid) from public, anon, authenticated;
grant execute on function public.steward_meeting_score_snapshot(uuid, uuid) to authenticated;
