-- Trust Tai OS, client imagery.
--
-- A company image is a real file a person uploaded. It lives in the public
-- `client-logos` bucket (already created in project okydosoacqdnursmmenf) at
-- `<organization_id>/<client_id>-<timestamp>.<ext>`, and its durable address is
-- written onto the canonical client row.
--
-- The application writes the address to `clients.metadata->>'logo_url'` today,
-- because that column already exists on every deployment. Run the statement
-- below to promote it to a first-class column; the read path prefers the
-- metadata value, so applying this is safe at any time and changes nothing on
-- its own.

alter table public.clients
  add column if not exists logo_url text;

comment on column public.clients.logo_url is
  'Durable public address of the company image a person uploaded. Never generated, never fetched from the web.';

-- Backfill from what the application already recorded.
update public.clients
   set logo_url = metadata->>'logo_url'
 where logo_url is null
   and metadata ? 'logo_url';

-- Storage note: uploads are performed server side with the service key, after
-- the caller's own token proved active membership and the client row was read
-- under that same session (see src/lib/client-logo.server.ts). No browser
-- session writes to the bucket, so no policy on storage.objects is required.
-- The bucket is public, so the recorded address resolves for anyone who has it.
