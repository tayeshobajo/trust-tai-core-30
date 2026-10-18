-- Consistent meeting-score snapshot (006): one-statement read of
-- denominator, verified, pending proposals, coverage currency and the
-- complete verdict. Access rules match every other reader; the verdict
-- is never assembled client-side from mixed reads.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

-- 1. Happy path: all fields present and internally consistent.
do $$
declare snap jsonb;
begin
  snap := public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(snap ? 'denominator', 'snapshot has denominator');
  perform public.test_assert(snap ? 'verified', 'snapshot has verified');
  perform public.test_assert(snap ? 'pendingProposals', 'snapshot has pendingProposals');
  perform public.test_assert(snap ? 'coverageCurrent', 'snapshot has coverageCurrent');
  perform public.test_assert(snap ? 'scopeVersion', 'snapshot has scopeVersion');
  perform public.test_assert(snap ? 'complete', 'snapshot has complete');
  perform public.test_assert((snap->>'denominator')::int >= 1, 'denominator reflects scope');
  -- Consistency: complete is exactly the conjunction of the parts.
  perform public.test_assert(
    (snap->>'complete')::boolean = (
      (snap->>'denominator')::int > 0
      and (snap->>'verified')::int = (snap->>'denominator')::int
      and (snap->>'pendingProposals')::int = 0
      and (snap->>'coverageCurrent')::boolean),
    'complete is the conjunction of the snapshot parts');
  -- After the 004/005 tests the scope changed without re-attestation, so
  -- coverage must read stale and complete must be false — never 100 from
  -- a stale attestation.
  perform public.test_assert(not (snap->>'coverageCurrent')::boolean,
    'stale coverage reads not current');
  perform public.test_assert(not (snap->>'complete')::boolean,
    'no complete verdict with stale coverage');
end $$;

-- 2. A fresh attestation flips coverageCurrent in the SAME snapshot.
do $$
declare snap jsonb;
begin
  perform public.steward_attest_coverage(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  snap := public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert((snap->>'coverageCurrent')::boolean,
    'fresh attestation reads current in the same snapshot');
  perform public.test_assert((snap->>'attestedAt') is not null, 'attestedAt populated');
end $$;

-- 3. Access rules: inactive member, viewer-only is fine for reads but
--    foreign org and unknown conversation are rejected.
select public.test_act_as('eeeeee00-0000-0000-0000-000000000001');
select public.test_denied($q$
  select public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'inactive member cannot read the snapshot');
select public.test_act_as('cccccccc-cccc-cccc-cccc-cccccccccccc');
select public.test_denied($q$
  select public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'foreign org member cannot read the snapshot');
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddd99') $q$,
  'unknown conversation rejected');
reset role;

-- 4. Anonymous callers get nothing.
set role anon;
select public.test_denied($q$
  select public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd') $q$,
  'anonymous cannot read the snapshot');
reset role;
