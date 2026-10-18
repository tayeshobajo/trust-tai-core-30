-- Coverage attestation: server-derived hash from the REAL conversations
-- transcript jsonb, invalidation, authority, source binding and operation
-- replay. The caller binds the attestation to the exact transcript hash +
-- scope version it reviewed; the function derives the CURRENT values
-- itself and rejects drift.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. No attestation: not covered.
do $$
begin
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'unattested conversation is not covered');
end $$;

-- 2. Attest: the reviewed hash/version match the current stored source.
do $$
declare a public.steward_coverage_attestations;
begin
  a := public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000001',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    1);
  perform public.test_assert(char_length(a.transcript_hash) = 64 and a.scope_version = 1,
    'attestation records derived hash and scope version');
  perform public.test_assert(a.attested_by = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'attester from auth.uid');
  perform public.test_assert(a.operation_id = 'c3000000-0000-0000-0000-000000000001',
    'attestation carries the client operation id');
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'matching state is covered');
end $$;

-- 2a. Operation replay: the SAME operation + SAME reviewed source returns
--     the recorded attestation instead of inserting a second row.
do $$
declare a public.steward_coverage_attestations; b public.steward_coverage_attestations;
begin
  select * into a from public.steward_coverage_attestations
   where organization_id = '11111111-1111-1111-1111-111111111111'
     and operation_id = 'c3000000-0000-0000-0000-000000000001';
  b := public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000001',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    1);
  perform public.test_assert(b.id = a.id, 'same operation replays the same attestation');
  perform public.test_assert((select count(*) from public.steward_coverage_attestations
    where organization_id = '11111111-1111-1111-1111-111111111111'
      and conversation_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd') = 1,
    'replay never inserts a second attestation');
end $$;

-- 2b. Same operation UUID with a CHANGED reviewed source conflicts.
select public.test_denied($q$
  select public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000001',
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 1) $q$,
  'changed payload with the same operation conflicts');

-- 3. Transcript edit invalidates coverage (derived hash changes).
do $$
begin
  update public.conversations
     set transcript = '{"segments":[{"speaker":"Tai","text":"EDITED transcript.","offset":0}]}'::jsonb
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'transcript edit invalidates coverage');
  update public.conversations
     set transcript = '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb
   where id = 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  perform public.test_assert(
    public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'restoring the identical transcript restores coverage (hash equality, not heuristic)');
end $$;

-- 4. Scope version change invalidates coverage.
do $$
begin
  perform public.steward_scope_add_item('11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd', '10000000-0000-0000-0000-000000000005',
    'manual_required', 'd9000000-0000-0000-0000-000000000001');
  perform public.test_assert(
    not public.steward_current_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    'scope version change invalidates coverage');
end $$;

-- 4a. Stale review rejected: the scope change bumped the version to 2, so
--     an attestation bound to the OLD reviewed version fails closed
--     instead of attesting an unseen source. Same for a stale hash.
select public.test_denied($q$
  select public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000002',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'),
    1) $q$,
  'stale scope version rejected — changed source is not attested');
select public.test_denied($q$
  select public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000003',
    'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 2) $q$,
  'stale transcript hash rejected — changed source is not attested');

-- 5. Unknown conversation rejected; authority: viewer/inactive/cross-org
--    cannot attest.
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd99',
    'c3000000-0000-0000-0000-000000000004', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1) $q$,
  'nonexistent conversation rejected');
select public.test_act_as('dddddd00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000005',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 2) $q$,
  'viewer cannot attest');
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_attest_coverage('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000006',
    private.steward_transcript_hash('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd'), 2) $q$,
  'inactive cannot attest');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select public.steward_attest_coverage('22222222-2222-2222-2222-222222222222', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c3000000-0000-0000-0000-000000000007', 'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc', 1) $q$,
  'cross-org conversation rejected');

-- 6. Attestations are immutable history; direct writes denied.
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  insert into public.steward_coverage_attestations
    (organization_id, conversation_id, transcript_hash, scope_version, attested_by)
  values ('11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'forged-hash-0000000000000000', 1, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa') $q$,
  'direct attestation insert denied');
reset role;
select public.test_denied($q$
  delete from public.steward_coverage_attestations where true $q$, 'attestation delete blocked by trigger');
