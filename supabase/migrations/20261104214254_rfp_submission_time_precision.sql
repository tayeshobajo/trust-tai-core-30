-- Apply after rfp_document_references. No ACL or sharing changes.
begin;
alter table public.rfp_submissions
 alter column submitted_at drop not null,
 add column submitted_date date,
 add column time_precision text not null default 'legacy';
-- Existing and older-client timestamps retain their bytes and are explicitly unclassified.
alter table public.rfp_submissions add constraint rfp_submission_time_precision check (
 (time_precision='legacy' and submitted_at is not null and submitted_date is null) or
 (time_precision='unknown' and submitted_at is null and submitted_date is null) or
 (time_precision='date' and submitted_at is null and submitted_date is not null and submitted_date <= (now() at time zone 'UTC')::date) or
 (time_precision in ('minute','second') and submitted_at is not null and submitted_date is null
   and submitted_at <= now() and submitted_at = date_trunc(time_precision, submitted_at))
);
alter table public.rfp_submission_amendments
 add column submitted_at timestamptz,
 add column submitted_date date,
 add column time_precision text;
-- NULL precision means this amendment does not change timing, including older clients.
alter table public.rfp_submission_amendments add constraint rfp_amendment_time_precision check (
 (time_precision is null and submitted_at is null and submitted_date is null) or
 (time_precision is not null and (
 (time_precision='unknown' and submitted_at is null and submitted_date is null) or
 (time_precision='date' and submitted_at is null and submitted_date is not null and submitted_date <= (now() at time zone 'UTC')::date) or
 (time_precision in ('minute','second') and submitted_at is not null and submitted_date is null
   and submitted_at <= now() and submitted_at = date_trunc(time_precision, submitted_at))
 ))
);
commit;
