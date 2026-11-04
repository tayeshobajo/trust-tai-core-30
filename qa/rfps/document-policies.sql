\set ON_ERROR_STOP on
-- Disposable local fixture database only; run after policies.sql.
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
insert into rfp_document_references(id,organization_id,opportunity_id,title,url,created_at) values('50000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Synthetic Doc','https://docs.google.com/document/d/synthetic/edit','2000-01-01');
insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,document_id,draft_id,reference,reason)
 select organization_id,opportunity_id,id,'50000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000001','Synthetic receipt','Recovered evidence' from rfp_submissions;
insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,reason)
 select organization_id,opportunity_id,id,'Correction: version unknown' from rfp_submissions;
do $$begin
 if (select count(*) from rfp_submission_amendments)<>2 then raise exception 'amendments not preserved';end if;
 if exists(select 1 from rfp_document_references where created_at<'2026-01-01') then raise exception 'forged timestamp';end if;
 begin update rfp_document_references set title='rewritten';raise exception 'document rewritten';exception when insufficient_privilege then null;end;
 begin delete from rfp_submission_amendments;raise exception 'evidence deleted';exception when insufficient_privilege then null;end;
 begin insert into rfp_document_references(organization_id,opportunity_id,title,url) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Bad','https://docs.google.com.evil.test/document/d/x/edit');raise exception 'bad URL allowed';exception when check_violation then null;end;
 begin insert into rfp_document_references(organization_id,opportunity_id,created_by,title,url) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','Spoof','https://docs.google.com/document/d/x/edit');raise exception 'spoof allowed';exception when insufficient_privilege then null;end;
end $$;
insert into rfp_opportunities(id,organization_id,title,kind,source_url,source_name,cycle,source_evidence) values('30000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','Other','rfp','https://example.org/other','QA','test','QA');
do $$begin
 begin insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,document_id,reason)
 select organization_id,'30000000-0000-0000-0000-000000000002',id,'50000000-0000-0000-0000-000000000001','Wrong opportunity' from rfp_submissions;
 raise exception 'cross-opportunity accepted';exception when foreign_key_violation then null;end;
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin
 if (select count(*) from rfp_document_references)<>1 or (select count(*) from rfp_submission_amendments)<>2 then raise exception 'shared viewer read failed';end if;
 begin insert into rfp_document_references(organization_id,opportunity_id,title,url) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','Viewer','https://docs.google.com/document/d/x/edit');raise exception 'viewer wrote document';exception when insufficient_privilege then null;end;
 begin insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,reason) select organization_id,opportunity_id,id,'Viewer' from rfp_submissions;raise exception 'viewer amended';exception when insufficient_privilege then null;end;
end $$;
reset role;
delete from rfp_access where user_id='20000000-0000-0000-0000-000000000002' and scope_id='30000000-0000-0000-0000-000000000001';
set role authenticated;
do $$begin if exists(select 1 from rfp_document_references) or exists(select 1 from rfp_submission_amendments) then raise exception 'unshared leak';end if;end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000003';
do $$begin if exists(select 1 from rfp_document_references) or exists(select 1 from rfp_submission_amendments) then raise exception 'cross-org leak';end if;end $$;
reset role;
set role anon;
do $$begin
 begin perform * from public.rfp_document_references;raise exception 'anon read';exception when insufficient_privilege then null;end;
 begin perform * from public.rfp_submission_amendments;raise exception 'anon evidence';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: document/amendment creator, viewer, unshared, cross-org, anonymous, forged author/time, URL, immutable history, cross-opportunity checks' result;
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
insert into rfp_submissions(id,organization_id,opportunity_id,submitted_at,channel) values('60000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002',now(),'Other synthetic portal');
do $$begin
 begin insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,document_id,reason) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','50000000-0000-0000-0000-000000000001','Wrong doc');raise exception 'cross-opportunity doc accepted';exception when foreign_key_violation then null;end;
 begin insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,draft_id,reason) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','40000000-0000-0000-0000-000000000001','Wrong file');raise exception 'cross-opportunity file accepted';exception when foreign_key_violation then null;end;
end $$;
reset role;
select 'PASS: independent document and file foreign-key isolation' result;
