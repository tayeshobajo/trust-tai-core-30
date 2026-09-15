-- PROPOSED, NOT APPLIED. For Codex review.
--
-- C19: lessons learned from human decisions. One new table, nothing existing
-- touched, no backfill, no change to review runs, findings, approvals or
-- their RLS.
--
-- What it holds: a sentence a person chose to keep after deciding a finding,
-- with the decision it came from, who kept it, and whether it is still in
-- use. Application code reads only unrevoked rows for the caller's own
-- organization and hands them to a later review as guidance about how to
-- write. It never edits a voice rule, a finding or an approval.
--
-- What it must not hold: facts. Application code refuses a lesson containing
-- an email address, a link, a figure or a long number before writing, so
-- nothing one conversation said can be reused as a claim in another.

CREATE TABLE IF NOT EXISTS public.comms_review_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  -- The decision underneath. Always present: a lesson with no decision is not
  -- a lesson, it is an opinion.
  source_finding_id uuid NOT NULL REFERENCES public.comms_review_findings(id) ON DELETE CASCADE,
  source_session_id uuid REFERENCES public.comms_review_sessions(id) ON DELETE SET NULL,
  lesson text NOT NULL CHECK (char_length(btrim(lesson)) BETWEEN 8 AND 300),
  source_note text NOT NULL DEFAULT '',
  promoted_by uuid NOT NULL REFERENCES auth.users(id),
  promoted_by_role text NOT NULL,
  promoted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),
  -- Revocation is a pair: a revoked row always says who revoked it.
  CONSTRAINT comms_review_lessons_revocation_complete
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  -- One decision teaches at most one live lesson.
  CONSTRAINT comms_review_lessons_one_per_finding UNIQUE (source_finding_id)
);

CREATE INDEX IF NOT EXISTS comms_review_lessons_org_live_idx
  ON public.comms_review_lessons (organization_id, promoted_at DESC)
  WHERE revoked_at IS NULL;

GRANT SELECT ON public.comms_review_lessons TO authenticated;
GRANT ALL ON public.comms_review_lessons TO service_role;

ALTER TABLE public.comms_review_lessons ENABLE ROW LEVEL SECURITY;

-- Reading is workspace-scoped to an active member, matching the other review
-- tables. Writing is done by the server with the service role only after it
-- has verified an active owner or admin, so no INSERT/UPDATE policy is
-- granted to authenticated callers.
CREATE POLICY "Active members read their workspace's lessons"
ON public.comms_review_lessons
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.organization_memberships m
    WHERE m.organization_id = comms_review_lessons.organization_id
      AND m.user_id = auth.uid()
      AND m.status = 'active'
  )
);

COMMENT ON TABLE public.comms_review_lessons IS
  'Lessons a person chose to keep from a decided review finding. Guidance about how to write, shown to later reviews in the same workspace. Never facts, never cross-organization, revocable.';
