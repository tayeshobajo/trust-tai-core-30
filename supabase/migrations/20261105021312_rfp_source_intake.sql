-- Staged: source files remain separate from proposal versions. No ACL rows or storage policies change.
begin;
alter table public.rfp_opportunities add column source_file_sha256 text not null default '' check(source_file_sha256='' or source_file_sha256 ~ '^[0-9a-f]{64}$');
alter table public.rfp_opportunities drop constraint rfp_opportunities_source_url_check, drop constraint rfp_opportunities_source_name_check, drop constraint rfp_opportunities_cycle_check, drop constraint rfp_opportunities_organization_id_source_url_cycle_key;
alter table public.rfp_opportunities add constraint rfp_source_identity check((source_url<>'' and source_url ~ '^https?://[^ /]+') or (source_url='' and source_file_sha256<>''));
create unique index rfp_unique_url_cycle on public.rfp_opportunities(organization_id,source_url,cycle) where source_url<>'';
create unique index rfp_unique_file_cycle on public.rfp_opportunities(organization_id,source_file_sha256,cycle) where source_file_sha256<>'';
create table public.rfp_source_files (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 file_name text not null, object_path text not null unique, sha256 text not null check(sha256 ~ '^[0-9a-f]{64}$'),
 foreign key(organization_id,opportunity_id) references public.rfp_opportunities(organization_id,id),
 check(object_path like organization_id::text || '/' || opportunity_id::text || '/' || id::text || '/%'),
 unique(organization_id,opportunity_id,sha256)
);
alter table public.rfp_source_files enable row level security;
revoke all on public.rfp_source_files from public,anon,authenticated;
grant select,insert on public.rfp_source_files to authenticated;
create policy source_read on public.rfp_source_files for select to authenticated using(exists(select 1 from public.rfp_opportunities o where o.id=opportunity_id and o.organization_id=rfp_source_files.organization_id));
create policy source_create on public.rfp_source_files for insert to authenticated with check(created_by=auth.uid() and public.rfp_can_work(organization_id,opportunity_id));
create function public.rfp_guard_source_file() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.file_name !~* '\.(pdf|docx|txt)$' or not exists(select 1 from storage.objects where bucket_id='rfp-drafts' and name=new.object_path) then raise exception 'Preserve a supported private source file first'; end if;
 new.created_at=now(); return new;
end $$;
revoke all on function public.rfp_guard_source_file() from public,anon;
create trigger source_file_guard before insert on public.rfp_source_files for each row execute function public.rfp_guard_source_file();
commit;
