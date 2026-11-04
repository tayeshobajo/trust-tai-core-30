-- REVIEW ONLY: no existing records, ACLs, storage or Drive permissions are changed.
begin;
create table public.rfp_document_references (
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 title text not null check(length(trim(title)) between 1 and 240),
 url text not null check(url ~ '^https://docs[.]google[.]com/document/d/[a-zA-Z0-9_-]+/edit$'),
 note text not null default '' check(length(note)<=2000),
 unique(organization_id,opportunity_id,id),
 foreign key(organization_id,opportunity_id) references public.rfp_opportunities(organization_id,id)
);
alter table public.rfp_submissions add constraint rfp_submission_identity unique(organization_id,opportunity_id,id);
create table public.rfp_submission_amendments (
 sequence bigint generated always as identity unique,
 id uuid primary key default gen_random_uuid(), organization_id uuid not null, opportunity_id uuid not null, submission_id uuid not null,
 created_by uuid not null default auth.uid() references auth.users(id), created_at timestamptz not null default now(),
 draft_id uuid, document_id uuid,
 submitted_version text not null default '' check(length(submitted_version)<=2000),
 reference text not null default '' check(length(reference)<=2000),
 evidence_url text not null default '' check(evidence_url='' or evidence_url ~ '^https?://[^ /@:]+([/:?#][^[:space:]]*)?$'),
 reason text not null check(length(trim(reason)) between 1 and 2000),
 foreign key(organization_id,opportunity_id,submission_id) references public.rfp_submissions(organization_id,opportunity_id,id),
 foreign key(organization_id,opportunity_id,draft_id) references public.rfp_draft_versions(organization_id,opportunity_id,id),
 foreign key(organization_id,opportunity_id,document_id) references public.rfp_document_references(organization_id,opportunity_id,id)
);
create index rfp_documents_opportunity on public.rfp_document_references(organization_id,opportunity_id);
create index rfp_amendments_submission on public.rfp_submission_amendments(organization_id,opportunity_id,submission_id);
do $$ declare t text; begin
 foreach t in array array['rfp_document_references','rfp_submission_amendments'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from public,anon,authenticated',t);
 execute format('grant select,insert on public.%I to authenticated',t);
 execute format('create policy child_read on public.%I for select to authenticated using(exists(select 1 from public.rfp_opportunities o where o.id=opportunity_id and o.organization_id=%I.organization_id))',t,t);
 execute format('create policy child_create on public.%I for insert to authenticated with check(created_by=auth.uid() and public.rfp_can_work(organization_id,opportunity_id))',t);
 execute format('create trigger stamp_history before insert on public.%I for each row execute function public.rfp_stamp_history()',t);
 end loop;
end $$;
grant usage on sequence public.rfp_submission_amendments_sequence_seq to authenticated;
commit;
