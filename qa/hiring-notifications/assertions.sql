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