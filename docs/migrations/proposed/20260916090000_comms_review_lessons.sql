-- PROPOSED, NOT APPLIED. For Codex review.
--
-- C19: writing habits kept from human decisions. One new table plus two
-- additional unique keys on existing tables so the new table's foreign keys
-- can be composite. Nothing existing is dropped, altered in shape, backfilled
-- or re-policied; runs, findings, approvals and their RLS are untouched.
--
-- What it holds: the identifier of ONE habit from a fixed catalogue the
-- application owns, the decision it came from, the run and draft that
-- decision belongs to, who made that decision and when, who kept it, and
-- whether it is still in use.
--
-- What it can never hold: reusable facts. The reused guidance is the
-- catalogue's own wording, chosen by id -- not text a person typed. A typed
-- note is stored in private_note, is shown only to people in this workspace,
-- and is never given to a review. This is deliberate: no pattern check can
-- tell a preference from a fact, because "Acme prefers Tuesday" is ordinary
-- words and a client fact at the same time.
--
-- Cross-organization reuse is impossible by construction: every foreign key
-- below carries organization_id, so a row cannot bind a finding, run or draft
-- from another workspace even if application code asked it to.

-- Composite keys the new foreign keys need. Both are additive uniqueness over
-- columns that are already unique-by-id, so neither can fail on real data.
ALTER TABLE public.comms_review_runs
  ADD CONSTRAINT comms_review_runs_session_org_key
  UNIQUE (id, session_id, organization_id);

ALTER TABLE public.comms_review_findings
  ADD CONSTRAINT comms_review_findings_run_org_key
  UNIQUE (id, run_id, organization_id);

CREATE TABLE IF NOT EXISTS public.comms_review_lessons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- The decision underneath, and the run and draft it actually belongs to.
  -- All three are bound together, in one workspace, by the keys below.
  source_finding_id uuid NOT NULL,
  source_run_id uuid NOT NULL,
  source_session_id uuid NOT NULL,

  -- The habit itself: an identifier from the application's fixed catalogue.
  -- The list is kept here as a check so a stray write cannot invent one; the
  -- wording a review is shown lives in application code, not in this column.
  category text NOT NULL CHECK (category IN (
    'keep_our_wording',
    'open_with_the_reason',
    'shorter_and_plainer',
    'answer_every_question',
    'name_the_next_step',
    'no_humour_when_sensitive',
    'no_promises_without_a_decision',
    'warmth_stays_specific'
  )),

  -- A short record of the decision, for people reading the list later. Not
  -- given to a review.
  source_note text NOT NULL DEFAULT '',
  -- A note typed by a person. Never given to a review, at any length.
  private_note text NOT NULL DEFAULT '' CHECK (char_length(private_note) <= 300),

  -- Who decided the finding, captured at the moment of keeping.
  decided_by uuid NOT NULL REFERENCES auth.users(id),
  decided_at timestamptz NOT NULL,

  promoted_by uuid NOT NULL REFERENCES auth.users(id),
  promoted_by_role text NOT NULL CHECK (promoted_by_role IN ('owner', 'admin')),
  promoted_at timestamptz NOT NULL DEFAULT now(),

  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id),

  -- Revocation is a pair: a revoked row always says who revoked it.
  CONSTRAINT comms_review_lessons_revocation_complete
    CHECK ((revoked_at IS NULL) = (revoked_by IS NULL)),
  -- One decision teaches at most one habit.
  CONSTRAINT comms_review_lessons_one_per_finding UNIQUE (source_finding_id),

  -- The finding belongs to this run, in this workspace.
  CONSTRAINT comms_review_lessons_finding_fkey
    FOREIGN KEY (source_finding_id, source_run_id, organization_id)
    REFERENCES public.comms_review_findings(id, run_id, organization_id) ON DELETE CASCADE,
  -- ...and that run belongs to this draft, in this workspace. Together these
  -- make "a habit from another client's conversation" unrepresentable.
  CONSTRAINT comms_review_lessons_run_fkey
    FOREIGN KEY (source_run_id, source_session_id, organization_id)
    REFERENCES public.comms_review_runs(id, session_id, organization_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS comms_review_lessons_org_live_idx
  ON public.comms_review_lessons (organization_id, promoted_at DESC)
  WHERE revoked_at IS NULL;

-- Content and provenance are immutable. The only permitted change is one-way
-- revocation, and a revoked row is never un-revoked: the history of what a
-- review was judged against has to stay readable afterwards.
CREATE OR REPLACE FUNCTION public.comms_review_lessons_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.source_finding_id IS DISTINCT FROM OLD.source_finding_id
    OR NEW.source_run_id IS DISTINCT FROM OLD.source_run_id
    OR NEW.source_session_id IS DISTINCT FROM OLD.source_session_id
    OR NEW.category IS DISTINCT FROM OLD.category
    OR NEW.source_note IS DISTINCT FROM OLD.source_note
    OR NEW.decided_by IS DISTINCT FROM OLD.decided_by
    OR NEW.decided_at IS DISTINCT FROM OLD.decided_at
    OR NEW.promoted_by IS DISTINCT FROM OLD.promoted_by
    OR NEW.promoted_by_role IS DISTINCT FROM OLD.promoted_by_role
    OR NEW.promoted_at IS DISTINCT FROM OLD.promoted_at
  THEN
    RAISE EXCEPTION 'A kept habit cannot be edited. Stop using it and keep another.';
  END IF;
  IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'Revocation is one way.';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER comms_review_lessons_immutable_trg
  BEFORE UPDATE ON public.comms_review_lessons
  FOR EACH ROW EXECUTE FUNCTION public.comms_review_lessons_immutable();

-- Least privilege, stated rather than assumed. Reading is for signed-in
-- members through RLS; every form of writing, and every deletion, is the
-- server's alone.
REVOKE ALL ON public.comms_review_lessons FROM PUBLIC;
REVOKE ALL ON public.comms_review_lessons FROM anon;
REVOKE ALL ON public.comms_review_lessons FROM authenticated;
GRANT SELECT ON public.comms_review_lessons TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.comms_review_lessons TO service_role;
-- Deliberately no DELETE to service_role: audit history is revoked, never
-- quietly removed. Rows disappear only when their workspace does.

ALTER TABLE public.comms_review_lessons ENABLE ROW LEVEL SECURITY;

-- Reading is workspace-scoped to an active member, matching the other review
-- tables. Writing is done by the server with the service role only after it
-- has verified an active owner or admin, so no INSERT/UPDATE policy exists
-- for authenticated callers.
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
  'Writing habits kept from a decided review finding: one identifier from the applications fixed catalogue, bound to the finding, run and draft it came from in the same workspace. The reused guidance is the catalogues own wording, never text from a conversation. Immutable, one-way revocable, never cross-organization.';

COMMENT ON COLUMN public.comms_review_lessons.private_note IS
  'A note for people in this workspace. Never given to a review, because no check can separate a preference from a client fact.';
