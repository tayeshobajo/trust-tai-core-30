-- REVIEW ONLY — NOT APPLIED. Exact minimal grant activation for the
-- proposed Steward backend. The up patches deliberately contain no grants;
-- enabling access is a separate reviewed decision. Run only after the
-- patches, RLS policies, and this script have all been reviewed together.
--
-- Table grants: SELECT only for authenticated. ALL writes flow through the
-- security-invoker functions, so no insert/update/delete table grants are
-- given to authenticated at all — clients cannot forge artifacts, receipts,
-- snapshots, or history directly. service_role gets full access for
-- reviewed operational tooling.

grant select on public.steward_canonical_runs to authenticated;
grant select on public.steward_task_receipts to authenticated;
grant select on public.steward_task_audit to authenticated;
grant select on public.steward_coverage_attestations to authenticated;
grant select on public.steward_scope_versions to authenticated;
grant select on public.steward_proposal_links to authenticated;
grant select on public.steward_scope_items to authenticated;
grant select on public.steward_scope_audit to authenticated;

grant all on public.steward_canonical_runs to service_role;
grant all on public.steward_task_receipts to service_role;
grant all on public.steward_task_audit to service_role;
grant all on public.steward_coverage_attestations to service_role;
grant all on public.steward_scope_versions to service_role;
grant all on public.steward_proposal_links to service_role;
grant all on public.steward_scope_items to service_role;
grant all on public.steward_scope_audit to service_role;

-- Function execute grants, authenticated only.
grant execute on function public.steward_request_canonical_run(uuid, uuid, text, uuid, jsonb) to authenticated;
grant execute on function public.steward_claim_canonical_run(uuid, integer) to authenticated;
grant execute on function public.steward_complete_canonical_run(uuid, uuid, text, jsonb) to authenticated;
grant execute on function public.steward_fail_canonical_run(uuid, uuid, text) to authenticated;
grant execute on function public.steward_verify_task(uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.steward_reopen_task(uuid, uuid, integer, uuid, text) to authenticated;
grant execute on function public.steward_attest_coverage(uuid, uuid) to authenticated;
grant execute on function public.steward_current_coverage(uuid, uuid) to authenticated;
grant execute on function public.steward_link_proposal(uuid, uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.steward_scope_add_item(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_amend_remove(uuid, uuid, uuid, text, uuid) to authenticated;
grant execute on function public.steward_scope_counts(uuid, uuid) to authenticated;
-- steward_resolve_input is an internal helper; not granted.
