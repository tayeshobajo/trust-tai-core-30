-- Coverage attestation: server-read hash/version, invalidation, authority.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. No attestation: not covered.
do $$
begin
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'unattested conversation is not covered');
end $$;

-- 2. Attest: hash/version come from stored state, not the caller.
do $$
declare a public.steward_coverage_attestations;
begin
  a := public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(a.transcript_hash = 'transcript-hash-v1-abcdef0123456789' and a.scope_version = 1,
    'attestation records stored hash and scope version');
  perform public.test_assert(a.attested_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'attester from auth.uid');
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'matching state is covered');
end $$;

-- 3. Transcript edit invalidates coverage.
do $$
begin
  update public.steward_conversations
     set transcript_hash = 'transcript-hash-v2-EDITED-0123456789', transcript_revision = 2
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'transcript edit invalidates coverage');
  update public.steward_conversations
     set transcript_hash = 'transcript-hash-v1-abcdef0123456789', transcript_revision = 1
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
end $$;

-- 4. Scope version change invalidates coverage.
do $$
begin
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000002',
    'manual_required', 'd9000000-0000-0000-0000-000000000001');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'scope version change invalidates coverage');
  -- Scope item stays (deletes are disabled by design); re-attest to restore
  -- a valid baseline for later suites.
end $$;

-- 5. Authority: viewer/inactive/cross-org cannot attest; unknown
--    conversation rejected.
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'viewer cannot attest');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'inactive cannot attest');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select public.steward_attest_coverage('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'cross-org conversation rejected');
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd99') $q$,
  'nonexistent conversation rejected');

-- 6. Attestations are immutable history; direct writes denied.
select public.test_denied($q$
  insert into public.steward_coverage_attestations
    (organization_id, conversation_id, transcript_hash, scope_version, attested_by)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'forged-hash-0000000000000000', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct attestation insert denied');
reset role;
select public.test_denied($q$
  delete from public.steward_coverage_attestations where true $q$, 'attestation delete blocked by trigger');
