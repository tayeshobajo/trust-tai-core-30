-- Trust Tai OS — Comms send loop schema
--
-- NOT YET APPLIED. This is the exact statement set of record for the Comms
-- end-to-end communication loop (send path + attachment handling). Apply it
-- against the Trust Tai Supabase project (ref okydosoacqdnursmmenf) before
-- relying on the two capabilities it adds; the shipped code degrades
-- gracefully until then (reads fall back to metadata-free timelines, sends
-- report staged files as unavailable rather than failing silently).
--
-- Additive only. Nothing here creates a table, duplicates a core entity, or
-- widens access beyond the existing membership model: authorization is the
-- same hardened helper every Comms table already uses,
-- `private.is_org_member(uuid)`, applied to storage objects by the
-- organization id that opens every object path.
--
-- Idempotent: every statement is safe to re-run.

-- --------------------------------------------------------- message attachments
-- Gmail-native attachment metadata on a synced or sent message: a jsonb
-- array of { filename, mime_type, size, attachment_id? }. Bytes never live
-- here — incoming bytes stay in Gmail and are proxied on demand; outgoing
-- bytes live in the `comms-drafts` bucket below until a successful send.
-- Table-level grants and RLS on public.comms_messages already exist
-- (docs/comms-integrations-schema.sql); a new column inherits them, so no
-- further grant or policy is required.

alter table public.comms_messages
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- ------------------------------------------------------------ draft storage
-- Private bucket holding files a person stages on an outgoing draft. Every
-- object path begins with the owning organization id, then the draft id:
--   <organization_id>/<draft_id>/<timestamp>-<file name>
-- (src/domain/comms-outgoing.ts). The browser uploads and removes with the
-- member's own session; the server send path downloads and sweeps with the
-- same member token, so `authenticated` policies below cover both — nothing
-- here needs or gets service-role or anon reach.
--
-- Retention note: a successful send deletes its staged files (Gmail becomes
-- the source of truth); a failed send keeps them so a retry never re-asks.
-- Files abandoned on drafts that are never sent or discarded simply remain
-- in the bucket — sweeping them is a future operational decision, not part
-- of this statement set.

insert into storage.buckets (id, name, public)
values ('comms-drafts', 'comms-drafts', false)
on conflict (id) do nothing;

drop policy if exists "comms_drafts_object_read" on storage.objects;
create policy "comms_drafts_object_read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'comms-drafts'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "comms_drafts_object_insert" on storage.objects;
create policy "comms_drafts_object_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'comms-drafts'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );

drop policy if exists "comms_drafts_object_delete" on storage.objects;
create policy "comms_drafts_object_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'comms-drafts'
    and private.is_org_member(((storage.foldername(name))[1])::uuid)
  );
