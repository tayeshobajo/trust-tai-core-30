ALTER TABLE public.studio_research_requests
 ADD COLUMN coordinator_renewal_authorization jsonb,
 ADD COLUMN coordinator_renewal_receipt jsonb,
 ADD COLUMN coordinator_approval_history jsonb NOT NULL DEFAULT '[]'::jsonb,
 ADD CONSTRAINT studio_renewal_objects CHECK ((coordinator_renewal_authorization IS NULL OR jsonb_typeof(coordinator_renewal_authorization)='object') AND (coordinator_renewal_receipt IS NULL OR jsonb_typeof(coordinator_renewal_receipt)='object') AND jsonb_typeof(coordinator_approval_history)='array');
CREATE OR REPLACE FUNCTION public.guard_studio_coordinator_receipt()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
DECLARE a jsonb; r jsonb; renewal boolean := false; now_ms bigint := floor(extract(epoch from clock_timestamp())*1000);
BEGIN
 IF TG_OP='INSERT' THEN
  IF new.coordinator_state IS NOT NULL OR new.coordinator_renewal_authorization IS NOT NULL OR new.coordinator_renewal_receipt IS NOT NULL OR new.coordinator_approval_history <> '[]'::jsonb THEN RAISE EXCEPTION 'Coordinator approval requires an existing request'; END IF;
  RETURN new;
 END IF;
 IF old.coordinator_renewal_authorization IS NOT NULL AND new.coordinator_renewal_authorization IS DISTINCT FROM old.coordinator_renewal_authorization THEN RAISE EXCEPTION 'Renewal authorization immutable'; END IF;
 IF old.coordinator_renewal_authorization IS NULL AND new.coordinator_renewal_authorization IS NOT NULL THEN
  a := new.coordinator_renewal_authorization;
  IF (old.coordinator_state='approved' AND new.coordinator_state='approved' AND old.coordinator_approval IS NOT NULL AND old.coordinator_admission IS NULL AND old.coordinator_brief IS NULL AND old.coordinator_result_digest IS NULL AND old.coordinator_renewal_receipt IS NULL AND old.coordinator_approval_history='[]'::jsonb
    AND a->>'version'='1' AND a->>'kind'='owner-approved-unlaunched-renewal' AND a->>'requestId'=old.request_id::text AND a->>'subjectId'=old.created_by::text AND a->>'issueId'=old.issue_id::text AND a->>'previousDigest'=old.coordinator_approval_digest AND a->>'executionEvidence'='no-host-job-or-trial-admission'
    AND (a->>'checkedAt')::bigint<=now_ms AND (a->>'expiresAt')::bigint>now_ms AND (a->>'expiresAt')::bigint-(a->>'checkedAt')::bigint BETWEEN 1 AND 120000
    AND (a->>'trialNotBefore')::bigint<=now_ms AND (a->>'trialExpiresAt')::bigint>now_ms AND (a->>'trialExpiresAt')::bigint-(a->>'trialNotBefore')::bigint BETWEEN 1 AND 3600000
    AND (old.coordinator_approval->>'expiresAt')::bigint<=now_ms) IS NOT TRUE THEN RAISE EXCEPTION 'Renewal authorization invalid'; END IF;
 END IF;
 IF old.coordinator_approval IS NOT NULL AND (new.coordinator_approval,new.coordinator_approval_digest) IS DISTINCT FROM (old.coordinator_approval,old.coordinator_approval_digest) THEN
  a := old.coordinator_renewal_authorization; r := new.coordinator_renewal_receipt;
  renewal := (a IS NOT NULL AND old.coordinator_state='approved' AND new.coordinator_state='approved' AND old.coordinator_admission IS NULL AND new.coordinator_admission IS NULL AND old.coordinator_brief IS NULL AND new.coordinator_brief IS NULL AND old.coordinator_result_digest IS NULL AND new.coordinator_result_digest IS NULL AND old.coordinator_renewal_receipt IS NULL AND old.coordinator_approval_history='[]'::jsonb
    AND a->>'requestId'=old.request_id::text AND a->>'subjectId'=old.created_by::text AND a->>'issueId'=old.issue_id::text AND a->>'previousDigest'=old.coordinator_approval_digest
    AND (a->>'checkedAt')::bigint<=now_ms AND (a->>'expiresAt')::bigint>now_ms
    AND new.coordinator_approval - 'approvedAt' - 'expiresAt' = old.coordinator_approval - 'approvedAt' - 'expiresAt'
    AND (old.coordinator_approval->>'expiresAt')::bigint<=now_ms
    AND (new.coordinator_approval->>'approvedAt')::bigint BETWEEN (a->>'checkedAt')::bigint AND now_ms
    AND (new.coordinator_approval->>'expiresAt')::bigint>now_ms
    AND (new.coordinator_approval->>'expiresAt')::bigint<=(a->>'trialExpiresAt')::bigint
    AND (new.coordinator_approval->>'expiresAt')::bigint-(new.coordinator_approval->>'approvedAt')::bigint BETWEEN 1 AND 300000
    AND r->>'version'='1' AND r->>'kind'='unlaunched-approval-renewal' AND r->>'previousDigest'=old.coordinator_approval_digest AND r->>'approvalDigest'=new.coordinator_approval_digest AND r->>'authorizationDigest' ~ '^[a-f0-9]{64}$' AND new.coordinator_approval_digest ~ '^[a-f0-9]{64}$'
    AND r->'renewedAt'=new.coordinator_approval->'approvedAt'
    AND new.coordinator_approval_history=jsonb_build_array(jsonb_build_object('approval',old.coordinator_approval,'approvalDigest',old.coordinator_approval_digest,'renewedAt',r->'renewedAt'))
  ) IS TRUE;
  IF NOT renewal THEN RAISE EXCEPTION 'Coordinator approval immutable'; END IF;
 END IF;
 IF NOT renewal AND (new.coordinator_renewal_receipt,new.coordinator_approval_history) IS DISTINCT FROM (old.coordinator_renewal_receipt,old.coordinator_approval_history) THEN RAISE EXCEPTION 'Renewal history immutable'; END IF;
 IF old.coordinator_state IN ('cancelled','ready') AND (new.coordinator_state,new.coordinator_approval,new.coordinator_approval_digest,new.coordinator_admission,new.coordinator_brief,new.coordinator_result_digest) IS DISTINCT FROM (old.coordinator_state,old.coordinator_approval,old.coordinator_approval_digest,old.coordinator_admission,old.coordinator_brief,old.coordinator_result_digest) THEN RAISE EXCEPTION 'Terminal coordinator receipt immutable'; END IF;
 IF old.coordinator_admission IS NOT NULL AND new.coordinator_admission IS DISTINCT FROM old.coordinator_admission THEN RAISE EXCEPTION 'Coordinator admission immutable'; END IF;
 IF old.coordinator_brief IS NOT NULL AND (new.coordinator_brief,new.coordinator_result_digest) IS DISTINCT FROM (old.coordinator_brief,old.coordinator_result_digest) THEN RAISE EXCEPTION 'Coordinator result immutable'; END IF;
 IF new.coordinator_state IS DISTINCT FROM old.coordinator_state AND (((old.coordinator_state IS NULL AND new.coordinator_state='approved') OR (old.coordinator_state='approved' AND new.coordinator_state IN ('running','cancelled')) OR (old.coordinator_state='running' AND new.coordinator_state IN ('ready','cancelled'))) IS NOT TRUE) THEN RAISE EXCEPTION 'Coordinator transition invalid'; END IF;
 RETURN new;
END $function$;
