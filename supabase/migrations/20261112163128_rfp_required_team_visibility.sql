-- LOCAL REVIEW ONLY: shares exactly five reviewed records; requires explicit future visibility.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
alter table public.rfp_opportunities add column audience text not null default 'private'
 check(audience in ('private','team_business','qa'));
-- Existing rows retain private classification and their existing explicit shares.
alter table public.rfp_opportunities alter column audience drop default;
-- Frozen reviewed backfill. Abort on changed inventory rather than broadening scope.
do $$begin
 if (select count(*) from public.rfp_opportunities where id in (
 'd6fa7158-ab5a-4c78-9d63-69b7ac7d2c8f','bae7cafc-ee8e-4f53-9300-0cf6164c6bbf',
 '6da6c89d-28ba-4174-9354-1c6790f64787','df76f52f-94d2-4cd6-8f8f-3d876b59f49e',
 'c60dbd87-9c83-4a27-8ceb-eaee5bc074c1') and organization_id='ee683a64-e045-4226-a8ff-4ae6590d6789'
 and created_by='e1b3c843-3a91-4c27-a291-9e6ced782b9f' and revision=2 and stage='captured')<>5 then
 raise exception 'Reviewed five-record inventory drift: stop and re-review'; end if;
end $$;
update public.rfp_opportunities set audience='team_business' where id in (
 'd6fa7158-ab5a-4c78-9d63-69b7ac7d2c8f','bae7cafc-ee8e-4f53-9300-0cf6164c6bbf',
 '6da6c89d-28ba-4174-9354-1c6790f64787','df76f52f-94d2-4cd6-8f8f-3d876b59f49e',
 'c60dbd87-9c83-4a27-8ceb-eaee5bc074c1');
create function public.rfp_team_reader(org uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select org='ee683a64-e045-4226-a8ff-4ae6590d6789'::uuid
 and public.rfp_has_access(org,org)
 and auth.uid() = any(array['e1b3c843-3a91-4c27-a291-9e6ced782b9f','241e0261-f2f6-4f0e-bcb1-c3f84de1a76e','2fac6177-d7f3-4702-b251-f158306471c5','476e81ff-97d1-4316-9cc3-b8397cdb3fa4','c16b7048-ae8b-483a-83a5-3735b2ad35cc','d97058cd-c2d7-41e6-a8e7-886c6da2ee4b','e1a7fec0-ec39-4b65-8978-4afebbcb4577']::uuid[]);
$$;
revoke all on function public.rfp_team_reader(uuid) from public,anon;
grant execute on function public.rfp_team_reader(uuid) to authenticated;
create function public.rfp_guard_audience() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.audience is null then raise exception 'Choose Team business, Private, or QA visibility before creating an opportunity' using errcode='23502'; end if;
 if tg_op='UPDATE' and new.audience is distinct from old.audience then
  raise exception 'Audience changes require a separate reviewed sharing operation' using errcode='42501';
 end if;
 if tg_op='INSERT' and new.audience='team_business' and
 (not public.rfp_team_reader(new.organization_id) or new.created_by is distinct from auth.uid()) then
  raise exception 'Team business capture requires an approved active creator' using errcode='42501';
 end if;
 return new;
end $$;
revoke all on function public.rfp_guard_audience() from public,anon;
grant execute on function public.rfp_guard_audience() to authenticated;
create trigger rfp_audience_guard before insert or update on public.rfp_opportunities
for each row execute function public.rfp_guard_audience();
alter policy rfp_read on public.rfp_opportunities using(
 public.rfp_has_access(organization_id,organization_id) and
 (created_by=(select auth.uid()) or public.rfp_has_access(organization_id,id)
 or (audience='team_business' and public.rfp_team_reader(organization_id))));
-- Existing child/storage read policies inherit opportunity visibility.
-- No edit, upload, approval, submission, delete or grant-administration changes.
commit;
