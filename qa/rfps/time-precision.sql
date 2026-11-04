\set ON_ERROR_STOP on
set role authenticated;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000001';
insert into rfp_submissions(id,organization_id,opportunity_id,submitted_at,time_precision,channel) values('60000000-0000-0000-0000-000000000003','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-01-05 12:34:00+00','minute','Minute evidence');
insert into rfp_submissions(organization_id,opportunity_id,submitted_at,submitted_date,time_precision,channel) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',null,'2026-01-05','date','Date evidence'),('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',null,null,'unknown','Unknown evidence');
insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,submitted_at,submitted_date,time_precision,reason) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003',null,'2026-01-06','date','Corrected date');
do $$begin
 if not exists(select 1 from rfp_submissions where time_precision='legacy' and submitted_at is not null) then raise exception 'legacy history lost';end if;
 if not exists(select 1 from rfp_submissions where id='60000000-0000-0000-0000-000000000003' and time_precision='minute') then raise exception 'original timing overwritten';end if;
 begin insert into rfp_submissions(organization_id,opportunity_id,submitted_at,time_precision,channel) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','2026-01-05 12:34:12+00','minute','Invalid precision');raise exception 'seconds accepted as minute';exception when check_violation then null;end;
 begin insert into rfp_submissions(organization_id,opportunity_id,submitted_at,time_precision,channel) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001',now(),'unknown','Invalid unknown');raise exception 'unknown instant accepted';exception when check_violation then null;end;
 begin update rfp_submissions set time_precision='second';raise exception 'submission overwritten';exception when insufficient_privilege then null;end;
 begin update rfp_submission_amendments set time_precision='unknown';raise exception 'amendment overwritten';exception when insufficient_privilege then null;end;
end $$;
set request.jwt.claim.sub='20000000-0000-0000-0000-000000000002';
do $$begin
 begin insert into rfp_submission_amendments(organization_id,opportunity_id,submission_id,time_precision,reason) values('10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000003','unknown','Unauthorized timing');raise exception 'unauthorized amendment';exception when insufficient_privilege then null;end;
end $$;
reset role;
select 'PASS: minute/date/unknown, legacy preservation, append-only timing corrections, invalid precision and authorization' result;
