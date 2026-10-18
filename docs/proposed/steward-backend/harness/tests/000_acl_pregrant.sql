-- ACL assertions BEFORE grants.review.sql: the up patches revoke execute
-- from PUBLIC/anon/authenticated, so nothing is callable by clients until
-- the reviewed activation script runs.
do $$
begin
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_request_canonical_run(uuid,uuid,text,uuid,jsonb)', 'execute'),
    'pre-grant: authenticated cannot execute request');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_verify_task(uuid,uuid,integer,uuid,text)', 'execute'),
    'pre-grant: authenticated cannot execute verify');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_claim_canonical_run(uuid,integer)', 'execute'),
    'pre-grant: authenticated cannot execute claim');
  perform public.test_assert(
    not has_function_privilege('service_role', 'public.steward_claim_canonical_run(uuid,integer)', 'execute'),
    'pre-grant: service_role cannot execute claim either');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.steward_scope_counts(uuid,uuid)', 'execute'),
    'pre-grant: anon cannot execute counts');
  perform public.test_assert(
    not has_function_privilege('public', 'public.steward_attest_coverage(uuid,uuid,uuid,text,integer)', 'execute'),
    'pre-grant: PUBLIC cannot execute attest');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_meeting_score_snapshot(uuid,uuid)', 'execute'),
    'pre-grant: authenticated cannot execute the score snapshot');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.steward_meeting_score_snapshot(uuid,uuid)', 'execute'),
    'pre-grant: anon cannot execute the score snapshot');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_meeting_verification_projection(uuid,uuid[])', 'execute'),
    'pre-grant: authenticated cannot execute the verification projection');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.steward_meeting_verification_projection(uuid,uuid[])', 'execute'),
    'pre-grant: anon cannot execute the verification projection');
end $$;
