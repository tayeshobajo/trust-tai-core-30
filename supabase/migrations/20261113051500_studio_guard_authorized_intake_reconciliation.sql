CREATE OR REPLACE FUNCTION public.guard_studio_research_request()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $function$
declare recovery_attachment boolean;
begin
 if (new.organization_id,new.request_id,new.created_by,new.created_at,new.topic,new.company_id,new.agent_id,new.id)
    is distinct from (old.organization_id,old.request_id,old.created_by,old.created_at,old.topic,old.company_id,old.agent_id,old.id) then
  raise exception 'Research request identity is immutable';
 end if;
 recovery_attachment := (
  old.state='dispatch_uncertain' and old.issue_id is null and new.state='submitted' and new.issue_id is not null
  and old.intake_recovery_authorization is not null and new.intake_recovery_authorization=old.intake_recovery_authorization
  and old.intake_recovery_authorization->>'kind'='owner-approved-single-intake-recovery'
  and old.intake_recovery_authorization->>'version'='1'
  and old.intake_recovery_authorization->>'requestId'=old.request_id::text
  and old.intake_recovery_authorization->>'subjectId'=old.created_by::text
  and old.intake_recovery_authorization->>'topic'=old.topic
  and old.intake_recovery_authorization->>'duplicateCheck'='no-matching-issue-or-execution-observed'
  and old.intake_recovery_receipt->>'stage'='claimed'
  and new.intake_recovery_receipt->>'stage'='attached'
  and new.intake_recovery_receipt->>'issueId'=new.issue_id::text
  and old.intake_recovery_receipt->>'bridgeKeyId'=old.intake_recovery_authorization->>'bridgeKeyId'
  and old.intake_recovery_receipt->>'authorizationDigest' ~ '^[0-9a-f]{64}$'
  and old.intake_recovery_receipt->>'requestDigest' ~ '^[0-9a-f]{64}$'
  and (new.intake_recovery_receipt - array['stage','issueId','attachedAt','reconciledExisting','lastObservation']) =
      (old.intake_recovery_receipt - array['stage','issueId','attachedAt','reconciledExisting','lastObservation'])
  and old.coordinator_state is null and new.coordinator_state is null
  and old.coordinator_approval is null and new.coordinator_approval is null
  and old.coordinator_approval_digest is null and new.coordinator_approval_digest is null
  and old.coordinator_admission is null and new.coordinator_admission is null
  and old.coordinator_brief is null and new.coordinator_brief is null
  and old.coordinator_result_digest is null and new.coordinator_result_digest is null
  and old.result is null and new.result is null and old.result_comment_id is null and new.result_comment_id is null
 ) is true;
 if old.state<>'dispatching' and (new.state,new.issue_id) is distinct from (old.state,old.issue_id) and not recovery_attachment then
  raise exception 'Research dispatch cannot be repeated';
 end if;
 if old.intake_recovery_authorization is not null and new.intake_recovery_authorization is distinct from old.intake_recovery_authorization then
  raise exception 'Intake recovery authorization immutable';
 end if;
 if old.intake_recovery_receipt is not null and new.intake_recovery_receipt is distinct from old.intake_recovery_receipt and not recovery_attachment then
  if (old.intake_recovery_receipt->>'stage'='claimed' and new.intake_recovery_receipt->>'stage'='claimed' and
      (new.intake_recovery_receipt-'lastObservation')=(old.intake_recovery_receipt-'lastObservation')) is not true then
    raise exception 'Intake recovery claim cannot be reset';
  end if;
 end if;
 if old.result_comment_id is not null and (new.result_comment_id,new.result) is distinct from (old.result_comment_id,old.result) then
  raise exception 'Research result requires explicit reconciliation';
 end if;
 return new;
end $function$;
