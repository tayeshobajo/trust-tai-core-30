-- REVIEW ONLY — NOT APPLIED. Exact minimal grant activation for the
-- proposed Steward backend. The up patches REVOKE execute from
-- PUBLIC/anon/authenticated, so nothing is callable until this script is
-- reviewed and applied. Run only after the patches, RLS policies, and
-- this script have all been reviewed together.
--
-- Table grants: SELECT only for authenticated. ALL writes flow through
-- the functions, so no insert/update/delete table grants are given to
-- authenticated at all — clients cannot forge artifacts, receipts,
-- snapshots, or history directly. service_role gets full table access for
-- the reviewed worker path.

grant select on public.steward_canonical_runs to authenticated;
grant select on public.steward_task_receipts to authenticated;
grant select on public.steward_task_audit to authenticated;
grant select on public.steward_coverage_attestations to authenticated;
grant select on public.steward_scope_versions to authenticated;
grant select on public.steward_proposal_ledger to authenticated;
grant select on public.steward_proposal_links to authenticated;
grant select on public.steward_proposal_decisions to authenticated;
grant select on public.steward_scope_items to authenticated;
grant select on public.steward_scope_audit to authenticated;

grant all on public.steward_canonical_runs to service_role;
grant all on public.steward_task_receipts to service_role;
grant all on public.steward_task_audit to service_role;
grant all on public.steward_coverage_attestations to service_role;
grant all on public.steward_scope_versions to service_role;
grant all on public.steward_proposal_ledger to service_role;
grant all on public.steward_proposal_links to service_role;
grant all on public.steward_scope_items to service_role;
grant all on public.steward_scope_audit to service_role;

-- Client-callable functions, authenticated only. A signed-in user may
-- REQUEST a run, verify/reopen with evidence, attest coverage, link
-- proposals and amend scope — always reauthorized inside the function.
grant execute on function public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.steward_verify_task(uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.steward_reopen_task(uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.steward_attest_coverage(uuid, uuid, uuid, text, integer) to authenticated;
grant execute on function public.steward_current_coverage(uuid, uuid) to authenticated;
grant execute on function public.steward_meeting_score_snapshot(uuid, uuid) to authenticated;
grant execute on function public.steward_meeting_verification_projection(uuid, uuid[]) to authenticated;
grant execute on function public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.steward_register_proposals(uuid, uuid, uuid, jsonb, jsonb) to authenticated;
grant execute on function public.steward_dismiss_proposal(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_add_item(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_sync_required(uuid, uuid, uuid) to authenticated;
grant execute on function public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_amend_reinstate(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_counts(uuid, uuid) to authenticated;

-- WORKER-ONLY transitions: claim/complete/fail are granted to
-- service_role EXCLUSIVELY. A signed-in client can never claim, complete
-- or fail a run, so nobody can forge an assistant artifact; the functions
-- additionally reject any caller whose auth.role() is not service_role
-- and revalidate the requester's current authority on every transition.
grant execute on function public.steward_claim_canonical_run(uuid, integer) to service_role;
grant execute on function public.steward_complete_canonical_run(uuid, uuid, text, jsonb) to service_role;
grant execute on function public.steward_uncertain_canonical_run(uuid, uuid, text) to service_role;
grant execute on function public.steward_fail_canonical_run(uuid, uuid, text, boolean) to service_role;

-- steward_resolve_input and all private.* helpers are internal; not
-- granted to any client role.
