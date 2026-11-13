do $$
begin
 if (select notifications_enabled from public.hiring_runtime where id) is distinct from false
 then raise exception 'Default must be disabled'; end if;
 if (select notifications_activated_at from public.hiring_runtime where id) is not null
 then raise exception 'No cutoff set without activation'; end if;
 if (select count(*) from public.career_delivery_outbox) <> 2
 then raise exception 'Historical rows changed'; end if;
 if exists(select 1 from public.career_delivery_outbox where notification_application_id is not null)
 then raise exception 'Historical backfill'; end if;
end $$;
-- Every nonempty partial intent must fail, including explicit NULL required fields.
-- Keep this local helper inside the isolated fixture; it is not a hosted routine.
create function pg_temp.expect_invalid_notification(
 test_name text, application_id uuid, purpose text, version integer,
 snapshot jsonb, mode text, lease uuid default null, lease_expires_at timestamptz default null
) returns void language plpgsql as $$
declare rejected_constraint text;
begin
 begin
  insert into public.career_delivery_outbox
   (id,status,notification_application_id,notification_purpose,
    notification_template_version,notification_snapshot,notification_mode,
    notification_lease,notification_lease_expires_at)
  values ('66666666-6666-4666-8666-666666666666','queued',application_id,
   purpose,version,snapshot,mode,lease,lease_expires_at);
 exception when check_violation then
  get stacked diagnostics rejected_constraint = constraint_name;
  if rejected_constraint <> 'hiring_notification_intent_shape' then raise; end if;
  return;
 end;
 raise exception 'Invalid notification accepted: %', test_name;
end $$;
do $$
begin
 begin
  -- Exact independent regression: purpose omitted, not merely an invalid string.
  insert into public.career_delivery_outbox
   (id,status,notification_application_id,notification_template_version,notification_snapshot,notification_mode)
  values ('66666666-6666-4666-8666-666666666666','queued',
   '77777777-7777-4777-8777-777777777777',1,'{}','live');
 exception when check_violation then
  if sqlerrm not like '%hiring_notification_intent_shape%' then raise; end if;
  return;
 end;
 raise exception 'Omitted purpose accepted';
end $$;
do $$
declare mask integer; invalid record;
begin
 for mask in 1..30 loop
  perform pg_temp.expect_invalid_notification(
   format('partial required fields mask %s',mask),
   case when (mask & 1) <> 0 then '77777777-7777-4777-8777-777777777777'::uuid end,
   case when (mask & 2) <> 0 then 'applicant_receipt' end,
   case when (mask & 4) <> 0 then 1 end,
   case when (mask & 8) <> 0 then '{}'::jsonb end,
   case when (mask & 16) <> 0 then 'live' end);
 end loop;
 for invalid in select * from (values
  ('invalid purpose','other',1,'live'),
  ('empty purpose','',1,'live'),
  ('zero version','applicant_receipt',0,'live'),
  ('negative version','applicant_receipt',-1,'live'),
  ('unsupported version','applicant_receipt',2,'live'),
  ('invalid mode','applicant_receipt',1,'test'),
  ('empty mode','applicant_receipt',1,'')
 ) as cases(name,purpose,version,mode) loop
  perform pg_temp.expect_invalid_notification(invalid.name,
   '77777777-7777-4777-8777-777777777777',invalid.purpose,invalid.version,'{}',invalid.mode);
 end loop;
 perform pg_temp.expect_invalid_notification('lease missing expiry',
  '77777777-7777-4777-8777-777777777777','applicant_receipt',1,'{}','live',
  '88888888-8888-4888-8888-888888888888');
 perform pg_temp.expect_invalid_notification('expiry missing lease',
  '77777777-7777-4777-8777-777777777777','applicant_receipt',1,'{}','live',null,
  '2026-11-13T03:00:00Z');
 perform pg_temp.expect_invalid_notification('legacy lease without intent',
  null,null,null,null,null,'88888888-8888-4888-8888-888888888888');
 perform pg_temp.expect_invalid_notification('legacy expiry without intent',
  null,null,null,null,null,null,'2026-11-13T03:00:00Z');
 perform pg_temp.expect_invalid_notification('legacy paired lease without intent',
  null,null,null,null,null,'88888888-8888-4888-8888-888888888888','2026-11-13T03:00:00Z');
end $$;
-- Positive controls: a new all-NULL legacy row, and every allowed purpose/mode.
insert into public.career_delivery_outbox (id,status)
values ('99999999-9999-4999-8999-999999999999','queued');
insert into public.career_delivery_outbox
 (id,status,notification_application_id,notification_purpose,
  notification_template_version,notification_snapshot,notification_mode,
  notification_lease,notification_lease_expires_at)
select ('aaaaaaaa-aaaa-4aaa-8aaa-' || lpad(n::text,12,'0'))::uuid,'queued',
 ('bbbbbbbb-bbbb-4bbb-8bbb-' || lpad(n::text,12,'0'))::uuid,purpose,1,'{}',mode,
 case when mode='qa' then '88888888-8888-4888-8888-888888888888'::uuid end,
 case when mode='qa' then '2026-11-13T03:00:00Z'::timestamptz end
from (select purpose,mode,row_number() over(order by purpose,mode) as n
 from unnest(array['applicant_receipt','role_owner_alert','tai_alert_copy']) as purposes(purpose)
 cross join unnest(array['live','qa']) as modes(mode)) as valid;
do $$ begin
 if (select count(*) from public.career_delivery_outbox) <> 9
 then raise exception 'Valid intent or all-NULL legacy row rejected'; end if;
end $$;
insert into public.career_delivery_outbox
(id,status,notification_application_id,notification_purpose,notification_template_version,notification_snapshot,notification_mode)
values ('33333333-3333-4333-8333-333333333333','queued',
'44444444-4444-4444-8444-444444444444','applicant_receipt',1,'{"synthetic":true}','qa');
do $$
begin
 begin
  insert into public.career_delivery_outbox
  (id,status,notification_application_id,notification_purpose,notification_template_version,notification_snapshot,notification_mode)
  values ('55555555-5555-4555-8555-555555555555','queued',
  '44444444-4444-4444-8444-444444444444','applicant_receipt',1,'{}','live');
  raise exception 'Duplicate intent accepted';
 exception when unique_violation then null; end;
 begin
  update public.career_delivery_outbox set notification_snapshot='{}'
  where id='33333333-3333-4333-8333-333333333333';
  raise exception 'Mutable snapshot accepted';
 exception when raise_exception then
  if sqlerrm <> 'Immutable notification intent' then raise; end if;
 end;
 begin
  update public.career_delivery_outbox set
   notification_application_id='44444444-4444-4444-8444-444444444444',
   notification_purpose='role_owner_alert',notification_template_version=1,
   notification_snapshot='{}',notification_mode='qa'
  where id='11111111-1111-4111-8111-111111111111';
  raise exception 'Historical intent accepted';
 exception when raise_exception then
  if sqlerrm <> 'Notification intent requires new canonical insertion' then raise; end if;
 end;
end $$;
update public.career_delivery_outbox set status='sent'
where id='33333333-3333-4333-8333-333333333333';
do $$ begin
 if (select status from public.career_delivery_outbox where id='33333333-3333-4333-8333-333333333333') <> 'sent'
 then raise exception 'Ordinary settlement blocked'; end if;
end $$;