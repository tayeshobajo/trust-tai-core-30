-- ACL assertions AFTER grants.review.sql: clients can call the
-- user-facing functions but NEVER the worker transitions or internal
-- helpers; the worker transitions are service_role-only.
do $$
begin
  perform public.test_assert(
    has_function_privilege('authenticated', 'public.steward_request_canonical_run(uuid,uuid,text,uuid,jsonb)', 'execute'),
    'post-grant: authenticated can execute request');
  perform public.test_assert(
    has_function_privilege('authenticated', 'public.steward_verify_task(uuid,uuid,integer,uuid,text)', 'execute'),
    'post-grant: authenticated can execute verify');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_claim_canonical_run(uuid,integer)', 'execute'),
    'post-grant: authenticated still cannot execute claim');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_complete_canonical_run(uuid,uuid,text,jsonb)', 'execute'),
    'post-grant: authenticated still cannot execute complete');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_fail_canonical_run(uuid,uuid,text,boolean)', 'execute'),
    'post-grant: authenticated still cannot execute fail');
  perform public.test_assert(
    has_function_privilege('service_role', 'public.steward_claim_canonical_run(uuid,integer)', 'execute'),
    'post-grant: service_role can execute claim');
  perform public.test_assert(
    not has_function_privilege('authenticated', 'public.steward_resolve_input(uuid,text,uuid)', 'execute'),
    'post-grant: resolve_input stays internal');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.steward_request_canonical_run(uuid,uuid,text,uuid,jsonb)', 'execute'),
    'post-grant: anon cannot execute request');
  perform public.test_assert(
    has_function_privilege('authenticated', 'public.steward_meeting_score_snapshot(uuid,uuid)', 'execute'),
    'post-grant: authenticated can execute the score snapshot');
  perform public.test_assert(
    not has_function_privilege('anon', 'public.steward_meeting_score_snapshot(uuid,uuid)', 'execute'),
    has_function_privilege('authenticated', 'public.steward_meeting_verification_projection(uuid,uuid[])', 'execute'),
    not has_function_privilege('anon', 'public.steward_meeting_verification_projection(uuid,uuid[])', 'execute'),
    'post-grant: anon cannot execute the score snapshot');
end $$;

-- Behavioral proof, not just ACL metadata: a signed-in client attempting
-- the worker transitions is rejected.
set role authenticated;
select public.test_act_as('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
select public.test_denied($q$
  select public.steward_claim_canonical_run(gen_random_uuid()) $q$,
  'client claim call denied');
select public.test_denied($q$
  select public.steward_complete_canonical_run(gen_random_uuid(), gen_random_uuid(), 'forged') $q$,
  'client complete call denied');
reset role;
