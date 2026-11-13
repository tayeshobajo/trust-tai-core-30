-- REVIEW CANDIDATE ONLY. NOT AN ACTIVATION SCRIPT. Do not put in migrations yet.
-- Exact canonical hiring_submit/outbox/claim/settle definitions must be supplied
-- before transactional intent generation or transport activation is implemented.
begin;
alter table public.hiring_runtime
  add column if not exists notifications_enabled boolean not null default false,
  add column if not exists notifications_activated_at timestamptz;
-- No UPDATE, historical SELECT/INSERT, cron installation or existing function replacement.
alter table public.career_delivery_outbox
  add column if not exists notification_application_id uuid,
  add column if not exists notification_purpose text,
  add column if not exists notification_template_version integer,
  add column if not exists notification_snapshot jsonb,
  add column if not exists notification_mode text,
  add column if not exists notification_lease uuid,
  add column if not exists notification_lease_expires_at timestamptz;
alter table public.career_delivery_outbox
  add constraint hiring_notification_intent_shape check (
    (notification_application_id is null and notification_purpose is null
      and notification_template_version is null and notification_snapshot is null
      and notification_mode is null and notification_lease is null
      and notification_lease_expires_at is null)
    or
    (notification_application_id is not null
      and notification_purpose is not null
      and notification_purpose in ('applicant_receipt','role_owner_alert','tai_alert_copy')
      and notification_template_version is not null
      and notification_template_version = 1
      and notification_snapshot is not null
      and notification_mode is not null
      and notification_mode in ('live','qa')
      and ((notification_lease is null and notification_lease_expires_at is null)
        or (notification_lease is not null and notification_lease_expires_at is not null)))
  );
create unique index hiring_notification_intent_unique
  on public.career_delivery_outbox
    (notification_application_id, notification_purpose, notification_template_version)
  where notification_application_id is not null;
-- Intent snapshots must not be mutable through ordinary outbox edits.
create function public.hiring_notification_snapshot_guard() returns trigger
language plpgsql set search_path = pg_catalog, public as $$
begin
  if old.notification_application_id is not null and
    row(old.notification_application_id,old.notification_purpose,
        old.notification_template_version,old.notification_snapshot,old.notification_mode)
    is distinct from
    row(new.notification_application_id,new.notification_purpose,
        new.notification_template_version,new.notification_snapshot,new.notification_mode)
  then raise exception 'Immutable notification intent'; end if;
  if old.notification_application_id is null and new.notification_application_id is not null
  then raise exception 'Notification intent requires new canonical insertion'; end if;
  return new;
end $$;
revoke all on function public.hiring_notification_snapshot_guard() from public;
create trigger hiring_notification_snapshot_guard before update
  on public.career_delivery_outbox for each row
  execute function public.hiring_notification_snapshot_guard();
-- Deliberately no additional grants/RLS changes: existing grants must be inspected
-- and reviewed to ensure members cannot forge system intents via generic INSERT.
-- No queue/claim/settle implementation can be safely inferred from column names.
commit;