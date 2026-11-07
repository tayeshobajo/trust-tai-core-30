-- LOCAL REVIEW ONLY: NEW scope beyond the six coordinator receipt columns.
-- Requires separately approved migration run by postgres. No automatic cleanup/retry.
begin;
create table public.studio_route_nonce_ledger (
 nonce uuid primary key,
 envelope_digest text not null check(envelope_digest ~ '^[a-f0-9]{64}$'),
 subject_id uuid not null, request_id uuid not null, issue_id uuid not null,
 approval_digest text not null check(approval_digest ~ '^[a-f0-9]{64}$'),
 operation text not null check(operation in ('authority','admission','result')),
 claim_id uuid not null unique default gen_random_uuid(),
 state text not null default 'claimed' check(state in ('claimed','done')),
 response text,
 created_at timestamptz not null default clock_timestamp(),
 constraint studio_route_response_shape check(((state='claimed' and response is null) or (state='done' and response is not null and octet_length(response)<=190000)) is true)
);
alter table public.studio_route_nonce_ledger enable row level security;
alter table public.studio_route_nonce_ledger force row level security;
revoke all on table public.studio_route_nonce_ledger from public,anon,authenticated,service_role;

create function public.studio_route_claim(p_nonce uuid,p_digest text,p_subject uuid,p_request uuid,p_issue uuid,p_approval text,p_operation text,p_issued_ms bigint,p_expires_ms bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.studio_route_nonce_ledger%rowtype; lease uuid; now_ms numeric := extract(epoch from clock_timestamp())*1000;
begin
 if (p_digest ~ '^[a-f0-9]{64}$' and p_approval ~ '^[a-f0-9]{64}$' and p_operation in ('authority','admission','result') and p_issued_ms<=now_ms and p_expires_ms>now_ms and p_expires_ms>p_issued_ms and p_expires_ms-p_issued_ms<=30000) is not true then raise exception 'route_rejected'; end if;
 if not exists(select 1 from public.studio_research_requests q where q.organization_id='ee683a64-e045-4226-a8ff-4ae6590d6789'::uuid and q.company_id='aaa4eceb-44fb-4492-823c-65d3d90c5519'::uuid and q.agent_id='5cbc9418-0ff9-4f1c-a807-c0632e26a538'::uuid and q.request_id=p_request and q.created_by=p_subject and q.issue_id=p_issue and q.coordinator_approval_digest=p_approval) then raise exception 'route_rejected'; end if;
 insert into public.studio_route_nonce_ledger(nonce,envelope_digest,subject_id,request_id,issue_id,approval_digest,operation) values(p_nonce,p_digest,p_subject,p_request,p_issue,p_approval,p_operation) on conflict(nonce) do nothing returning claim_id into lease;
 select * into strict r from public.studio_route_nonce_ledger where nonce=p_nonce for update;
 if (r.envelope_digest=p_digest and r.subject_id=p_subject and r.request_id=p_request and r.issue_id=p_issue and r.approval_digest=p_approval and r.operation=p_operation) is not true then raise exception 'route_rejected'; end if;
 return jsonb_build_object('claimed',lease is not null,'claimId',lease,'response',r.response,'digest',r.envelope_digest);
end $$;
create function public.studio_route_finish(p_nonce uuid,p_digest text,p_claim uuid,p_response text)
returns boolean language plpgsql security definer set search_path='' as $$
declare r public.studio_route_nonce_ledger%rowtype;
begin
 if (p_digest ~ '^[a-f0-9]{64}$' and p_claim is not null and p_response is not null and octet_length(p_response)>0 and octet_length(p_response)<=190000) is not true then raise exception 'route_rejected'; end if;
 select * into strict r from public.studio_route_nonce_ledger where nonce=p_nonce for update;
 if (r.envelope_digest=p_digest and r.claim_id=p_claim) is not true then raise exception 'route_rejected'; end if;
 if r.state='done' then
  if r.response is distinct from p_response then raise exception 'route_rejected'; end if;
  return true;
 end if;
 update public.studio_route_nonce_ledger set state='done',response=p_response where nonce=p_nonce and envelope_digest=p_digest and claim_id=p_claim and state='claimed';
 if not found then raise exception 'route_rejected'; end if;
 return true;
end $$;
revoke all on function public.studio_route_claim(uuid,text,uuid,uuid,uuid,text,text,bigint,bigint) from public,anon,authenticated,service_role;
revoke all on function public.studio_route_finish(uuid,text,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.studio_route_claim(uuid,text,uuid,uuid,uuid,text,text,bigint,bigint) to service_role;
grant execute on function public.studio_route_finish(uuid,text,uuid,text) to service_role;
commit;
-- Rollback: disable callback first; revoke RPC execution. Retain consumed ledger rows.
-- Dropping the ledger/returning a consumed nonce to available is NOT a safe rollback.
