\set ON_ERROR_STOP on
insert into organizations values('10000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000002');
insert into auth.users values('20000000-0000-0000-0000-000000000001'),('20000000-0000-0000-0000-000000000002'),('20000000-0000-0000-0000-000000000003');
insert into organization_memberships values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001'),('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003');
insert into rfp_access values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','work'),('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','view');
-- Simulate an unrelated legacy broad storage policy: restrictive guards must still hold.
grant update,delete on storage.objects to authenticated;
create policy legacy_broad_storage on storage.objects for all to authenticated using(true) with check(true);
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
insert into rfp_opportunities(id,organization_id,title,kind,source_url,source_name,cycle,source_evidence) values('30000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic policy test','grant','https://example.org/qa','QA','test','QA evidence');
do $$begin
 if (select count(*) from rfp_opportunities)<>1 then raise exception 'creator cannot read'; end if;
 begin update rfp_opportunities set stage='submitted'; raise exception 'submission gate failed'; exception when raise_exception then if SQLERRM='submission gate failed' then raise; end if; end;
 begin update rfp_opportunities set organization_id='10000000-0000-0000-0000-000000000002'; raise exception 'identity guard failed'; exception when raise_exception then if SQLERRM='identity guard failed' then raise; end if; end;
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence) values('10000000-0000-0000-0000-000000000001','Duplicate','grant','https://example.org/qa/?utm_source=test#section','QA','TEST','QA');raise exception 'duplicate guard failed';exception when unique_violation then null;end;
end $$;
insert into storage.objects(bucket_id,name) values('rfp-drafts','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/qa.txt');
insert into rfp_draft_versions(id,organization_id,opportunity_id,file_name,object_path,sha256) values('40000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','qa.txt','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/40000000-0000-0000-0000-000000000001/qa.txt',repeat('a',64));
insert into rfp_submissions(organization_id,opportunity_id,submitted_at,channel) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now(),'Historical QA');
update rfp_opportunities set stage='submitted';
do $$begin update storage.objects set name='overwritten';if found then raise exception 'storage overwritten';end if;delete from storage.objects;if found then raise exception 'storage deleted';end if;end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin
 if (select count(*) from rfp_opportunities)<>0 or (select count(*) from storage.objects)<>0 or (select count(*) from rfp_draft_versions)<>0 then raise exception 'same-org unshared leak';end if;
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence) values('10000000-0000-0000-0000-000000000001','View write','rfp','https://example.org/view','QA','test','QA');raise exception 'viewer wrote';exception when insufficient_privilege then null;end;
end $$;
reset role;
insert into rfp_access values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000001','view');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin
 if (select count(*) from rfp_opportunities)<>1 or (select count(*) from storage.objects)<>1 then raise exception 'shared viewer cannot read';end if;
 update rfp_opportunities set title='forbidden';if found then raise exception 'viewer updated';end if;
 begin insert into storage.objects(bucket_id,name) values('rfp-drafts','10000000-0000-0000-0000-000000000001/30000000-0000-0000-0000-000000000001/bad.txt');raise exception 'viewer uploaded';exception when insufficient_privilege then null;end;
 begin update rfp_draft_versions set note='overwrite';raise exception 'version overwritten';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
do $$begin if (select count(*) from rfp_opportunities)<>0 or (select count(*) from storage.objects)<>0 then raise exception 'cross-org leak';end if;end $$;
reset role;
select 'PASS: creator, same-org unshared, shared viewer, cross-org, immutable draft, duplicate, submission and identity gates' as result;
