-- Comms message fidelity: full-body storage for synced Gmail mail.
--
-- The timeline's law is that Comms shows the actual meaningful email, never
-- Gmail's preview snippet. The sync now reads `format=full` and stores the
-- extracted body next to the snippet, which keeps its list-preview role.
--
-- Columns added here:
--   body_html, sanitized HTML (allowlisted tags/attributes, no scripts,
--                no remote resources), for in-place layout and inline
--                images. Sanitization happens at ingest, server-side.
--   body_text, the full readable text (plain part, or HTML flattened).
--                Added by docs/comms-integrations-schema.sql; repeated here
--                idempotently so this file applies standalone.
--
-- Idempotent: safe to run more than once. Nothing is backfilled by SQL, -- already-stored messages enrich on the next normal sync, which upserts on
-- (organization_id, provider, provider_message_id) instead of duplicating.

alter table public.comms_messages
  add column if not exists body_text text;

alter table public.comms_messages
  add column if not exists body_html text;

comment on column public.comms_messages.body_text is
  'Full readable message body (plain part preferred, HTML flattened otherwise). Never truncated; the snippet column stays the list preview.';

comment on column public.comms_messages.body_html is
  'Sanitized HTML body, allowlisted tags only, cid: image references preserved, remote resources stripped and counted in provenance.blocked_remote_images.';
