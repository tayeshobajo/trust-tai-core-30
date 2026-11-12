alter table organization_memberships add column status text not null default 'active';
create or replace function private.is_org_member(org uuid) returns boolean language sql stable as $$select exists(select 1 from public.organization_memberships where organization_id=org and user_id=auth.uid() and status='active')$$;

insert into auth.users values('476e81ff-97d1-4316-9cc3-b8397cdb3fa4'),('59e9bf32-f719-41b0-b350-d62aae1ea07c'),('20000000-0000-0000-0000-000000000099');
insert into auth.users values('241e0261-f2f6-4f0e-bcb1-c3f84de1a76e'),('2fac6177-d7f3-4702-b251-f158306471c5'),('c16b7048-ae8b-483a-83a5-3735b2ad35cc'),('d97058cd-c2d7-41e6-a8e7-886c6da2ee4b'),('e1a7fec0-ec39-4b65-8978-4afebbcb4577');
insert into organization_memberships select 'ee683a64-e045-4226-a8ff-4ae6590d6789',id,'active' from auth.users;
insert into rfp_access select 'ee683a64-e045-4226-a8ff-4ae6590d6789',id,'ee683a64-e045-4226-a8ff-4ae6590d6789','work' from auth.users;
set local role authenticated;
set local request.jwt.claim.sub='e1b3c843-3a91-4c27-a291-9e6ced782b9f';
insert into rfp_opportunities(id,organization_id,title,kind,source_url,source_name,cycle,source_evidence,audience)
select ('30000000-0000-0000-0000-00000000000'||n)::uuid,'ee683a64-e045-4226-a8ff-4ae6590d6789','Synthetic','rfp','https://example.org/'||n,'QA','test','synthetic',a from (values(1,'team_business'),(2,'private'),(3,'qa')) v(n,a);
insert into storage.objects(bucket_id,name) values('rfp-drafts','ee683a64-e045-4226-a8ff-4ae6590d6789/30000000-0000-0000-0000-000000000001/a/file.txt');
do $$begin begin update rfp_opportunities set audience='team_business' where audience='private';raise exception 'audience mutation allowed';exception when insufficient_privilege then null;end;end$$;
do $$begin
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence)
 values('ee683a64-e045-4226-a8ff-4ae6590d6789','Omitted audience','rfp','https://example.org/omitted','QA','test','test');
 raise exception 'legacy silent visibility accepted';exception when not_null_violation then null;end;
end$$;
set local request.jwt.claim.sub='476e81ff-97d1-4316-9cc3-b8397cdb3fa4';
do $$begin
 if (select count(*) from rfp_opportunities)<>6 or (select count(*) from storage.objects)<>1 then raise exception 'team read failed or private/QA leak';end if;
 if rfp_can_work('ee683a64-e045-4226-a8ff-4ae6590d6789','30000000-0000-0000-0000-000000000001') then raise exception 'team acquired work';end if;
 update rfp_opportunities set title='forbidden';if found then raise exception 'team edited';end if;
 begin insert into storage.objects(bucket_id,name) values('rfp-drafts','ee683a64-e045-4226-a8ff-4ae6590d6789/30000000-0000-0000-0000-000000000001/a/forbidden.txt');raise exception 'team uploaded';exception when insufficient_privilege then null;end;
 begin insert into rfp_submissions(organization_id,opportunity_id,submitted_at,channel) values('ee683a64-e045-4226-a8ff-4ae6590d6789','30000000-0000-0000-0000-000000000001',now(),'test');raise exception 'team submitted';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$declare u uuid;begin
 foreach u in array array['e1b3c843-3a91-4c27-a291-9e6ced782b9f','241e0261-f2f6-4f0e-bcb1-c3f84de1a76e','2fac6177-d7f3-4702-b251-f158306471c5','476e81ff-97d1-4316-9cc3-b8397cdb3fa4','c16b7048-ae8b-483a-83a5-3735b2ad35cc','d97058cd-c2d7-41e6-a8e7-886c6da2ee4b','e1a7fec0-ec39-4b65-8978-4afebbcb4577']::uuid[] loop
 perform set_config('request.jwt.claim.sub',u::text,true);
 if not rfp_team_reader('ee683a64-e045-4226-a8ff-4ae6590d6789') or rfp_team_reader('10000000-0000-0000-0000-000000000099') then raise exception 'cohort or cross-org failure';end if;
 end loop;
end$$;
set local request.jwt.claim.sub='476e81ff-97d1-4316-9cc3-b8397cdb3fa4';
-- Preserve an existing explicit view share even when its audience remains private.
insert into rfp_access values('ee683a64-e045-4226-a8ff-4ae6590d6789','476e81ff-97d1-4316-9cc3-b8397cdb3fa4','30000000-0000-0000-0000-000000000002','view');
set local role authenticated;
do $$begin if (select count(*) from rfp_opportunities)<>7 then raise exception 'existing explicit view lost';end if;end$$;
reset role;
update organization_memberships set status='inactive' where user_id='476e81ff-97d1-4316-9cc3-b8397cdb3fa4';
set local role authenticated;
do $$begin if exists(select 1 from rfp_opportunities) then raise exception 'inactive leak';end if;end$$;
set local request.jwt.claim.sub='59e9bf32-f719-41b0-b350-d62aae1ea07c';
do $$begin
 if exists(select 1 from rfp_opportunities) then raise exception 'QA team leak';end if;
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence,audience) values('ee683a64-e045-4226-a8ff-4ae6590d6789','synthetic','rfp','https://example.org/qa','QA','test','test','team_business');raise exception 'QA shared';exception when insufficient_privilege then null;end;
end$$;
set local request.jwt.claim.sub='20000000-0000-0000-0000-000000000099';
do $$begin if exists(select 1 from rfp_opportunities) then raise exception 'future user leak';end if;end$$;
reset role;
select 'PASS fixed cohort read/download, no private/QA/inactive/future-account leak, no edit/upload/submission, no audience mutation' result;
