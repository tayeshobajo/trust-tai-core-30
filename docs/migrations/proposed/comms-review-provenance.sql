-- PROPOSED — NOT APPLIED. For Codex review.
--
-- Nothing in the application depends on this file. It is written because two
-- pieces of provenance currently have no column of their own, and are being
-- carried in places that work but read poorly:
--
--   1. The voice rules a review was held against are recorded as a stage
--      string on the run, e.g. "voice_profile:<uuid>@v3", or
--      "voice_profile:none" when the workspace has no stored rules and the
--      review said so. A column would make it queryable.
--   2. An approval's context revision is read back through the run it is
--      bound to, because comms_review_approvals has no column for it. The
--      binding is sound — the run carries the revision the database stamped —
--      but a column would make the approval self-describing.
--
-- Both are additive and safe to apply at any time; the application keeps
-- working unchanged if they are never applied.

ALTER TABLE public.comms_review_runs
  ADD COLUMN IF NOT EXISTS voice_profile_id uuid
    REFERENCES public.comms_voice_profiles(id),
  ADD COLUMN IF NOT EXISTS voice_version integer;

ALTER TABLE public.comms_review_approvals
  ADD COLUMN IF NOT EXISTS context_revision bigint;

-- If the approvals column is added, the approval guard should also check it
-- against the run's revision, and the application write should populate it.
-- Neither change is made here: that is a decision for whoever applies this.
