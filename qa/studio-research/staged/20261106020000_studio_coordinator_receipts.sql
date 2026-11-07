-- LOCAL REVIEW ONLY. Not in automatic migration directory. Additive to reviewed request table.
begin;
alter table public.studio_research_requests
 add column coordinator_state text,
 add column coordinator_approval jsonb,
 add column coordinator_approval_digest text,
 add column coordinator_admission jsonb,
 add column coordinator_brief jsonb,
 add column coordinator_result_digest text,
 add constraint studio_coordinator_receipt_shape check (
  (coordinator_state is null and coordinator_approval is null and coordinator_approval_digest is null and coordinator_admission is null and coordinator_brief is null and coordinator_result_digest is null)
  or ((coordinator_state in ('approved','running','cancelled','ready') and state='submitted' and result is null and result_comment_id is null
   and jsonb_typeof(coordinator_approval)='object' and octet_length(coordinator_approval::text)<=100000
   and coordinator_approval_digest ~ '^[a-f0-9]{64}$'
   and coordinator_approval->'request'->>'organizationId'=organization_id::text
   and coordinator_approval->'request'->>'requestId'=request_id::text
   and coordinator_approval->'request'->>'topic'=topic
   and coordinator_approval->>'approvedBy'=created_by::text
   and coordinator_approval->>'companyId'=company_id::text
   and coordinator_approval->>'agentId'=agent_id::text
   and coordinator_approval->>'issueId'=issue_id::text
   and coordinator_approval->>'projectId'='d5160872-5d1c-41fb-b793-9ad7e4469f86'
   and ((coordinator_state='approved' and coordinator_admission is null) or
        (coordinator_state in ('running','ready') and jsonb_typeof(coordinator_admission)='object') or coordinator_state='cancelled')
   and (coordinator_admission is null or ((octet_length(coordinator_admission::text)<=200000 and coordinator_admission->>'origin'='coordinator'
     and coordinator_admission->>'approvalDigest'=coordinator_approval_digest and coordinator_admission->>'requestId'=request_id::text
     and coordinator_admission->>'issueId'=issue_id::text and coordinator_admission->>'runId' ~ '^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$') is true))
   and ((coordinator_state='ready' and jsonb_typeof(coordinator_brief)='object' and octet_length(coordinator_brief::text)<=150000
     and coordinator_brief->'research'->>'requestId'=request_id::text and coordinator_result_digest ~ '^[a-f0-9]{64}$')
     or (coordinator_state<>'ready' and coordinator_brief is null and coordinator_result_digest is null))) is true)
 );
create function public.guard_studio_coordinator_receipt() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' then
  if new.coordinator_state is not null then raise exception 'Coordinator approval requires an existing request'; end if;
  return new;
 end if;
 if old.coordinator_state in ('cancelled','ready') and (new.coordinator_state,new.coordinator_approval,new.coordinator_approval_digest,new.coordinator_admission,new.coordinator_brief,new.coordinator_result_digest) is distinct from (old.coordinator_state,old.coordinator_approval,old.coordinator_approval_digest,old.coordinator_admission,old.coordinator_brief,old.coordinator_result_digest) then raise exception 'Terminal coordinator receipt immutable'; end if;
 if old.coordinator_approval is not null and (new.coordinator_approval,new.coordinator_approval_digest) is distinct from (old.coordinator_approval,old.coordinator_approval_digest) then raise exception 'Coordinator approval immutable'; end if;
 if old.coordinator_admission is not null and new.coordinator_admission is distinct from old.coordinator_admission then raise exception 'Coordinator admission immutable'; end if;
 if old.coordinator_brief is not null and (new.coordinator_brief,new.coordinator_result_digest) is distinct from (old.coordinator_brief,old.coordinator_result_digest) then raise exception 'Coordinator result immutable'; end if;
 if new.coordinator_state is distinct from old.coordinator_state and ((
  (old.coordinator_state is null and new.coordinator_state='approved') or
  (old.coordinator_state='approved' and new.coordinator_state in ('running','cancelled')) or
  (old.coordinator_state='running' and new.coordinator_state in ('ready','cancelled'))
 ) is not true) then raise exception 'Coordinator transition invalid'; end if;
 return new;
end $$;
revoke all on function public.guard_studio_coordinator_receipt() from public,anon,authenticated,service_role;
create trigger guard_studio_coordinator_receipt before insert or update on public.studio_research_requests for each row execute function public.guard_studio_coordinator_receipt();
commit;
