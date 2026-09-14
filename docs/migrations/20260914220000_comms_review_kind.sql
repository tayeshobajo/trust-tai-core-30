-- APPLIED — exact text applied by Codex to the shared project
-- `okydosoacqdnursmmenf` as migration `comms_review_kind`. DO NOT REAPPLY.
--
-- The proposal it came from is kept, marked superseded, at
--   docs/migrations/proposed/20260914220000_comms_review_kind.sql
--
-- No user record was altered: every statement is additive, existing rows keep
-- a null `kind` and a null `structured_source` and read as "not recorded".
-- The app still tolerates the columns being absent, because an older
-- deployment may be running against a database without them.
--
-- Purpose: record what a review is a review of — a message, an email or a
-- proposal — and, for proposals, the structure the text was rendered from, so
-- an audit can reconstruct the exact reviewed words from the same source.
--
-- Additive only. No existing column, constraint, policy, grant or trigger is
-- changed. No data is rewritten. Existing rows read as "kind not recorded".

alter table public.comms_review_sessions
  add column if not exists kind text;

alter table public.comms_review_sessions
  drop constraint if exists comms_review_sessions_kind_chk;
alter table public.comms_review_sessions
  add constraint comms_review_sessions_kind_chk
  check (kind is null or kind in ('message', 'email', 'proposal'));

-- The structured source a proposal's words were rendered from. Immutable in
-- practice: a change to the sections produces a new version through the
-- existing version path, exactly like any other edit.
alter table public.comms_review_versions
  add column if not exists structured_source jsonb;

-- Nothing else is needed: reads are covered by the existing organization
-- scoped SELECT policies, writes by the existing verified service path, and
-- the existing triggers already bump context_revision when a version is
-- added, so a changed proposal invalidates an approval exactly as today.
