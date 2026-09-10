-- Trust Tai OS. Ops Integration v1
-- Idempotency key for activity rows written by external specialist apps (Ops).
--
-- Why this exists
--   Ops retries. Without a key that means "the same happening", a retried
--   webhook writes a second activities row, and Intelligence would count the
--   same technical issue twice. Reading before writing is not race safe: two
--   concurrent Ops retries can both read "absent" and both insert. The
--   database has to hold the guarantee, so this is the smallest possible
--   migration that lets it.
--
-- What it does NOT do
--   It creates no second event table, changes no existing column, and makes no
--   existing write invalid. `source_event_key` is nullable, so every current
--   producer (Scout, Comms, Roadmap, Projects) keeps working untouched.
--
-- Apply: yes, run this against the Trust Tai Supabase project before Ops
-- starts writing at volume. The Trust Tai OS reader is already tolerant of a
-- missing key: it falls back to (event name + chain + occurred_at) when
-- de-duplicating in memory.

alter table public.activities
  add column if not exists source_event_key text;

comment on column public.activities.source_event_key is
  'Stable id of the originating event in the producing app. Unique per organization and app.';

-- One row per (organization, producing app, source event). Partial so existing
-- rows without a key are unaffected.
create unique index if not exists activities_source_event_key_unique
  on public.activities (organization_id, app_key, source_event_key)
  where source_event_key is not null;
