-- STAGED ONLY. No access records are seeded; deployment requires explicit approval.
-- Existing private.is_org_member(uuid) is the authoritative membership predicate.
begin;
create table public.rfp_access (
 organization_id uuid not null references public.organizations(id), user_id uuid not null references auth.users(id),
 scope_id uuid not null, -- organization_id for workspace, opportunity UUID for shared record
 access_level text not null check(access_level in ('view','work')),
 primary key(organization_id,user_id,scope_id)
);
alter table public.rfp_access enable row level security;
revoke all on public.rfp_access from public,anon,authenticated;
grant select on public.rfp_access to authenticated;
create policy rfp_access_self on public.rfp_access for select to authenticated
 using(user_id=(select auth.uid()) and private.is_org_member(organization_id));
-- ACL provisioning is intentionally administrative and out-of-band. No browser grants.
create function public.rfp_has_access(org uuid, scope uuid, writing boolean default false) returns boolean
 language sql stable security invoker set search_path='' as $$
 select private.is_org_member(org) and exists(select 1 from public.rfp_access a
 where a.organization_id=org and a.user_id=(select auth.uid()) and a.scope_id=scope
 and (not writing or a.access_level='work'));
$$;
revoke all on function public.rfp_has_access(uuid,uuid,boolean) from public,anon;
grant execute on function public.rfp_has_access(uuid,uuid,boolean) to authenticated;
create table public.rfp_opportunities (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), updated_at timestamptz not null default now(), revision integer not null default 0,
 title text not null check(length(trim(title)) between 1 and 240), kind text not null check(kind in ('rfp','grant')),
 source_url text not null check(source_url ~ '^https?://[^ /]+'), source_name text not null check(length(trim(source_name))>0), cycle text not null check(length(trim(cycle))>0),
 applicant text not null default '', eligibility text not null default 'unknown' check(eligibility in ('unknown','reviewing','eligible','ineligible')),
 eligibility_notes text not null default '', requirements text not null default '', deadline_date text not null default '' check(deadline_date='' or deadline_date ~ '^\d{4}-\d{2}-\d{2}$'),
 deadline_time text not null default '' check(deadline_time='' or deadline_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'), deadline_timezone text not null default '',
 owner_label text not null default '', next_action text not null default '', source_evidence text not null check(length(trim(source_evidence))>0),
 source_checked_at timestamptz, source_state text not null default 'unchecked' check(source_state in ('unchecked','available','failed')),
 stage text not null default 'captured' check(stage in ('captured','qualifying','preparing','review','ready','submitted','awarded','declined','closed')),
 unique(organization_id,id), unique(organization_id,source_url,cycle),
 check(deadline_time='' or (deadline_date<>'' and deadline_timezone<>''))
);
create function public.rfp_can_work(org uuid, opportunity uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select public.rfp_has_access(org,org,true) and exists(select 1 from public.rfp_opportunities o where o.id=opportunity and o.organization_id=org
 and (o.created_by=(select auth.uid()) or public.rfp_has_access(org,opportunity,true)));
$$;
revoke all on function public.rfp_can_work(uuid,uuid) from public,anon;
grant execute on function public.rfp_can_work(uuid,uuid) to authenticated;
alter table public.rfp_opportunities enable row level security;
revoke all on public.rfp_opportunities from public,anon,authenticated;
grant select,insert,update on public.rfp_opportunities to authenticated;
create policy rfp_read on public.rfp_opportunities for select to authenticated using(public.rfp_has_access(organization_id,organization_id) and (created_by=(select auth.uid()) or public.rfp_has_access(organization_id,id)));
create policy rfp_create on public.rfp_opportunities for insert to authenticated with check(public.rfp_has_access(organization_id,organization_id,true) and created_by=(select auth.uid()) and stage='captured');
create policy rfp_edit on public.rfp_opportunities for update to authenticated using(public.rfp_has_access(organization_id,organization_id,true) and (created_by=(select auth.uid()) or public.rfp_has_access(organization_id,id,true))) with check(public.rfp_has_access(organization_id,organization_id,true) and (created_by=(select auth.uid()) or public.rfp_has_access(organization_id,id,true)));
create table public.rfp_draft_versions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 file_name text not null, object_path text not null unique, note text not null default '', sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 unique(organization_id,opportunity_id,id), foreign key(organization_id,opportunity_id) references public.rfp_opportunities(organization_id,id),
 check(object_path like organization_id::text || '/' || opportunity_id::text || '/' || id::text || '/%')
);
create table public.rfp_draft_approvals (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null, draft_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 foreign key(organization_id,opportunity_id,draft_id) references public.rfp_draft_versions(organization_id,opportunity_id,id), unique(draft_id)
);
create table public.rfp_submissions (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null, draft_id uuid,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), recorded_at timestamptz not null default now(),
 submitted_at timestamptz not null check(submitted_at<=now()), channel text not null check(length(trim(channel))>0), reference text not null default '', evidence_url text not null default '' check(evidence_url='' or evidence_url ~ '^https?://[^ /]+'),
 foreign key(organization_id,opportunity_id) references public.rfp_opportunities(organization_id,id),
 foreign key(organization_id,opportunity_id,draft_id) references public.rfp_draft_versions(organization_id,opportunity_id,id)
);
create table public.rfp_discovery_checks (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null references public.organizations(id),
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(), checked_at timestamptz not null default now(),
 note text not null check(length(trim(note))>0), source_count integer not null check(source_count>0), failed_count integer not null check(failed_count>=0 and failed_count<=source_count)
);
do $$ declare t text; begin
 foreach t in array array['rfp_draft_versions','rfp_draft_approvals','rfp_submissions'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert on public.%I to authenticated',t);
 execute format('create policy child_read on public.%I for select to authenticated using(exists(select 1 from public.rfp_opportunities o where o.id=opportunity_id and o.organization_id=%I.organization_id))',t,t);
 execute format('create policy child_create on public.%I for insert to authenticated with check(created_by=auth.uid() and public.rfp_can_work(organization_id,opportunity_id))',t);
 end loop;
end $$;
alter table public.rfp_discovery_checks enable row level security;
revoke all on public.rfp_discovery_checks from public,anon,authenticated;
grant select,insert on public.rfp_discovery_checks to authenticated;
create policy check_read on public.rfp_discovery_checks for select to authenticated using(public.rfp_has_access(organization_id,organization_id));
create policy check_create on public.rfp_discovery_checks for insert to authenticated with check(created_by=auth.uid() and public.rfp_has_access(organization_id,organization_id,true));
create function public.rfp_canonical_source(value text) returns text language sql immutable set search_path='' as $$
 with parts as (select split_part(split_part(value,'#',1),'?',1) as base, split_part(split_part(value,'#',1),'?',2) as query),
 normalized as (select regexp_replace(base,'/+$','') as base,
 (select string_agg(param,'&' order by param) from unnest(string_to_array(query,'&')) param where param<>'' and param !~* '^(utm_|mc_|fbclid=|gclid=)') as query from parts)
 select base || case when query is null then '' else '?' || query end from normalized;
$$;
revoke all on function public.rfp_canonical_source(text) from public,anon;
grant execute on function public.rfp_canonical_source(text) to authenticated;
create function public.rfp_guard_opportunity() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.source_url=public.rfp_canonical_source(new.source_url);
 new.cycle=lower(trim(new.cycle));
 if TG_OP='UPDATE' then
 if (new.id,new.organization_id,new.created_by,new.created_at) is distinct from (old.id,old.organization_id,old.created_by,old.created_at) then raise exception 'Opportunity identity is immutable'; end if;
 new.revision=old.revision+1; new.updated_at=now();
 end if;
 if new.deadline_timezone<>'' and not exists(select 1 from pg_timezone_names where name=new.deadline_timezone) then raise exception 'Unknown deadline timezone'; end if;
 if new.deadline_date<>'' then perform new.deadline_date::date; end if;
 if new.stage='ready' and (new.applicant='' or new.eligibility<>'eligible' or not exists(select 1 from public.rfp_draft_approvals a where a.opportunity_id=new.id)) then raise exception 'Ready requires an applicant, confirmed eligibility and an approved draft'; end if;
 if new.stage in ('submitted','awarded','declined') and not exists(select 1 from public.rfp_submissions s where s.opportunity_id=new.id) then raise exception 'Record the actual submission first'; end if;
 return new;
end $$;
revoke all on function public.rfp_guard_opportunity() from public,anon;
create trigger rfp_guard before insert or update on public.rfp_opportunities for each row execute function public.rfp_guard_opportunity();
-- Append-only history timestamps are server-authored, never supplied by a browser.
create function public.rfp_stamp_history() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 new.created_at=now();
 if TG_TABLE_NAME='rfp_submissions' then new.recorded_at=now(); end if;
 if TG_TABLE_NAME='rfp_discovery_checks' then new.checked_at=now(); end if;
 if TG_TABLE_NAME='rfp_draft_versions' then
  if new.file_name !~* '\.(pdf|docx|txt)$' or not exists(select 1 from storage.objects where bucket_id='rfp-drafts' and name=new.object_path) then raise exception 'Upload a supported private file before recording the version';end if;
 end if;
 return new;
end $$;
revoke all on function public.rfp_stamp_history() from public,anon;
do $$declare t text;begin
 foreach t in array array['rfp_draft_versions','rfp_draft_approvals','rfp_submissions','rfp_discovery_checks'] loop
 execute format('create trigger stamp_history before insert on public.%I for each row execute function public.rfp_stamp_history()',t);
 end loop;
end $$;
-- Private bucket. No overwrite/delete permissions: every draft is immutable.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('rfp-drafts','rfp-drafts',false,20971520,array['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','application/octet-stream']);
create policy rfp_file_read on storage.objects for select to authenticated using(bucket_id='rfp-drafts' and exists(select 1 from public.rfp_opportunities o where o.organization_id::text=split_part(name,'/',1) and o.id::text=split_part(name,'/',2)));
create policy rfp_file_insert on storage.objects for insert to authenticated with check(bucket_id='rfp-drafts' and exists(select 1 from public.rfp_opportunities o where o.organization_id::text=split_part(name,'/',1) and o.id::text=split_part(name,'/',2) and public.rfp_can_work(o.organization_id,o.id)));
-- Restrictive guards also protect this bucket if an older broad permissive
-- storage policy exists. Other buckets retain their existing behavior.
create policy rfp_storage_read_guard on storage.objects as restrictive for select to authenticated using(bucket_id<>'rfp-drafts' or exists(select 1 from public.rfp_opportunities o where o.organization_id::text=split_part(name,'/',1) and o.id::text=split_part(name,'/',2)));
create policy rfp_storage_insert_guard on storage.objects as restrictive for insert to authenticated with check(bucket_id<>'rfp-drafts' or exists(select 1 from public.rfp_opportunities o where o.organization_id::text=split_part(name,'/',1) and o.id::text=split_part(name,'/',2) and public.rfp_can_work(o.organization_id,o.id)));
create policy rfp_storage_update_guard on storage.objects as restrictive for update to authenticated using(bucket_id<>'rfp-drafts') with check(bucket_id<>'rfp-drafts');
create policy rfp_storage_delete_guard on storage.objects as restrictive for delete to authenticated using(bucket_id<>'rfp-drafts');
commit;
