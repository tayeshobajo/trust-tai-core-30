-- Trust Tai OS. Roadmap Intelligence v2.1 (additive)
--
-- Studio became model backed. An artifact is now a composed client facing
-- document rather than a deterministic skeleton, so it has to carry the same
-- provenance discipline as research: which provider wrote it, which model,
-- what was refused during validation, and whether a person has since edited it.
--
-- The human edit flag is what stops regeneration from quietly overwriting a
-- document someone has already worked on. Nothing here changes existing rows'
-- behaviour, and every column is nullable or defaulted.
--
-- Apply to the Trust Tai Supabase project (okydosoacqdnursmmenf).

alter table public.roadmap_artifacts
  add column if not exists provider text,
  add column if not exists model text,
  -- Lines the validator refused because the approved packet did not back them.
  add column if not exists rejected jsonb not null default '[]'::jsonb,
  -- True once a person has edited the composed document by hand.
  add column if not exists human_edited boolean not null default false,
  add column if not exists edited_at timestamptz,
  add column if not exists edited_by uuid references auth.users(id) on delete set null;

-- No new grants or policies are required: roadmap_artifacts already grants
-- select, insert, update and delete to authenticated, with row level security
-- scoped to organization membership through private.is_org_member.

-- Applied live on okydosoacqdnursmmenf. Verified through PostgREST.
