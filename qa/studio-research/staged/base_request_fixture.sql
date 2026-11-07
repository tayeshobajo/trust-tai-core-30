-- STAGED: requires explicit review/application. No access grants, credentials or schedules seeded.
begin;
create table public.studio_research_requests (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id),
 request_id uuid not null, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 topic text not null check(length(trim(topic)) between 3 and 1200),
 company_id uuid not null check(company_id='aaa4eceb-44fb-4492-823c-65d3d90c5519'),
 agent_id uuid not null check(agent_id='5cbc9418-0ff9-4f1c-a807-c0632e26a538'),
 issue_id uuid unique,
 state text not null default 'dispatching' check(state in ('dispatching','submitted','dispatch_uncertain')),
 result jsonb, result_comment_id uuid,
 unique(organization_id,request_id),
 check((state='submitted')=(issue_id is not null)),
 check((result is null)=(result_comment_id is null)),
 check(result is null or ((state='submitted' and jsonb_typeof(result)='object' and octet_length(result::text)<=150000 and result ? 'requestId' and result->>'requestId'=request_id::text) is true))
);
alter table public.studio_research_requests enable row level security;
revoke all on public.studio_research_requests from public, anon, authenticated, service_role;
-- Reset inherited defaults too: DELETE/TRUNCATE would erase dispatch tombstones.
grant select,insert,update on public.studio_research_requests to service_role;
-- Service-only storage. Every authenticated server entry verifies current Studio authority.
create function public.guard_studio_research_request() returns trigger language plpgsql set search_path='' as $$
begin
 if (new.organization_id,new.request_id,new.created_by,new.created_at,new.topic,new.company_id,new.agent_id,new.id)
    is distinct from (old.organization_id,old.request_id,old.created_by,old.created_at,old.topic,old.company_id,old.agent_id,old.id) then
  raise exception 'Research request identity is immutable';
 end if;
 if old.state<>'dispatching' and (new.state,new.issue_id) is distinct from (old.state,old.issue_id) then
  raise exception 'Research dispatch cannot be repeated';
 end if;
 if old.result_comment_id is not null and (new.result_comment_id,new.result) is distinct from (old.result_comment_id,old.result) then
  raise exception 'Research result requires explicit reconciliation';
 end if;
 return new;
end $$;
revoke all on function public.guard_studio_research_request() from public,anon,authenticated;
create trigger guard_studio_research_request before update on public.studio_research_requests for each row execute function public.guard_studio_research_request();
commit;
