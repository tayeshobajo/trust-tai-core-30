-- Runs inside a transaction after staged migration; only synthetic local fixtures.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
insert into rfp_opportunities(id,organization_id,title,kind,source_url,source_name,cycle,source_evidence,source_file_sha256) values('90000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','Synthetic file intake','rfp','','','','Synthetic source',repeat('b',64));
do $$begin
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence,source_file_sha256) values('10000000-0000-0000-0000-000000000001','Duplicate','rfp','','','','Synthetic source',repeat('b',64));raise exception 'duplicate file accepted';exception when unique_violation then null;end;
 begin insert into rfp_opportunities(organization_id,title,kind,source_url,source_name,cycle,source_evidence) values('10000000-0000-0000-0000-000000000001','No source','rfp','','','','Synthetic source');raise exception 'missing source accepted';exception when check_violation then null;end;
end $$;
insert into storage.objects(bucket_id,name) values('rfp-drafts','10000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000002/source.txt');
insert into rfp_source_files(id,organization_id,opportunity_id,file_name,object_path,sha256) values('90000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','source.txt','10000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000001/90000000-0000-0000-0000-000000000002/source.txt',repeat('b',64));
do $$begin
 if (select count(*) from rfp_source_files)<>1 then raise exception 'owner cannot read source';end if;
 begin update rfp_source_files set file_name='rewrite.txt';raise exception 'source rewritten';exception when insufficient_privilege then null;end;
 begin insert into rfp_draft_approvals(organization_id,opportunity_id,draft_id) values('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000002');raise exception 'source approved as draft';exception when foreign_key_violation then null;end;
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin if exists(select 1 from rfp_source_files) then raise exception 'unshared source leak';end if;end $$;
reset role;
insert into rfp_access values('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','90000000-0000-0000-0000-000000000001','view');
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin
 if (select count(*) from rfp_source_files)<>1 then raise exception 'viewer cannot read shared source';end if;
 begin insert into rfp_source_files(organization_id,opportunity_id,file_name,object_path,sha256) values('10000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000001','forbidden.txt','invalid',repeat('c',64));raise exception 'viewer wrote source';exception when insufficient_privilege or raise_exception then if SQLERRM='viewer wrote source' then raise;end if;end;
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
do $$begin if exists(select 1 from rfp_source_files) then raise exception 'cross-org source leak';end if;end $$;
reset role;
set role anon;
do $$begin begin perform * from rfp_source_files;raise exception 'anonymous source leak';exception when insufficient_privilege then null;end;end $$;
reset role;
select 'PASS: source identity, duplicate protection, owner/viewer/unshared/cross-org/anonymous, immutable source and proposal separation' result;
