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

-- 2b. A scope change after attestation makes coverage stale in the very
--     next snapshot — a stale attestation can never keep a meeting
--     complete, and the new pending proposal gates the verdict too.
do $$
declare snap jsonb; added integer;
begin
  added := public.steward_register_proposals(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'c0000000-0000-0000-0000-00000000000a',
    '[{"source_key":"ext-9001","kind":"action","statement":"Snapshot gating proposal"}]'::jsonb,
    '{"segments":[{"speaker":"Tai","text":"Synthetic Soji roadmap discussion.","offset":0}]}'::jsonb);
  perform public.test_assert(added = 1, 'gating proposal registered');
  snap := public.steward_meeting_score_snapshot(
    '11111111-1111-1111-1111-111111111111', 'dddddddd-dddd-dddd-dddd-dddddddddddd');
  perform public.test_assert(not (snap->>'coverageCurrent')::boolean,
    'stale coverage reads not current');
  perform public.test_assert((snap->>'pendingProposals')::int >= 1,
    'undecided proposal pending in snapshot');
  perform public.test_assert(not (snap->>'complete')::boolean,
    'no complete verdict with stale coverage or pending proposals');
  -- Clean up the gating proposal so later suites are unaffected.
  perform public.steward_dismiss_proposal(
    '11111111-1111-1111-1111-111111111111',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    (select id from public.steward_proposal_ledger
      where organization_id = '11111111-1111-1111-1111-111111111111'
        and source_key = 'ext-9001'),
    'Snapshot test cleanup dismissal.', 'c0000000-0000-0000-0000-00000000000b');
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
