# Canonical run bridge — PROPOSED, UNAPPLIED

Status: proposal only. Nothing in this document is applied to the database or
the server. The workroom shows AI preparation for canonical business tasks as
unavailable until this contract (or a reviewed successor) exists.

## Problem

`executeStewardAgentTask` (src/lib/steward-agent-runner.server.ts) is built for
legacy agent-assigned tasks: on a completed run it marks the task `complete`
and writes a `task.completed` feed entry (`recordAgentCompletion`). That is
correct for `assignee_kind = 'agent'` tasks and wrong for canonical shared
board work:

- A text artifact is not task delivery; a website build cannot be claimed
  from a text-artifact runner.
- No run may auto-complete a canonical task or grant verified credit.
- The keyword risk classifier must not be weakened, and notes containing
  "no publish" are not authorization.

## Proposed contract

1. New run kind `canonical_preparation` on `steward_agent_runs` (additive
   column or check-value extension), with `task_id` referencing the canonical
   task and `requested_by` the person who started it.
2. Server authority: same `agentExecutionAuthority` rules (view-only roles
   never execute; members only their own created/owned tasks; owner/admin any),
   plus the existing `classifyAgentTask` gate unchanged.
3. Output contract: the run produces a draft artifact with `evidence_refs`
   into supplied context only (same `safeAgentArtifact` validation). The
   artifact is stored on the run row and shown as review material.
4. Explicitly NOT written: task status, completion evidence, receipts,
   activities feed completion entries, verified counts. The run row is the
   only record. A person delivers the task through the existing editor.
5. Idempotency: the client generates a unique operation UUID per deliberate
   action request. The run row stores `client_operation_id` plus an input
   snapshot: `{action, input_refs, input_revisions}` (each selected input's
   identity and revision at request time). A retry with the SAME operation
   UUID returns the existing run and never reruns the model. A later
   deliberate rerun uses a NEW operation UUID and creates a new run, even for
   the same task+action — the old artifact is never silently reused or
   overwritten. The earlier `org/task/action:v1` key is rejected: it would
   permanently pin an obsolete artifact.
6. Bounded actions v1: `prepare_brief`, `draft_roadmap`, `prepare_handoff`,
   `review_output` — each mapped to a fixed instruction template with no new
   external tools and `webSearch: false`.
7. Input selection and provenance: the requester explicitly picks the inputs
   (task fields, recorded context links, selected transcript excerpts). The
   run row records exactly which inputs, with revisions, were supplied; the
   artifact's `evidence_refs` may point only at those supplied inputs.
8. Output digest: each artifact carries a content digest (hash of the stored
   text) so the UI can show "this draft" versus "a newer draft" without
   re-reading full text, and retries can prove they returned the same run.
9. State transition authority: runs move `queued → running → complete|failed`
   only inside the server function that owns the run row, with row locking
   and the requester's authority re-checked on every transition. No client
   write path can mark a run complete, and no run transition touches the
   canonical task.

## Fixture acceptance (human vs assistant)

- The accountable person and the executing assistant are distinct fields in
  every fixture: a run is started by a person, executed by the assistant, and
  never changes who is accountable for the task.
- Fixtures assert: retry with the same operation UUID returns run #1; a new
  operation UUID for the same task+action creates run #2; an artifact digest
  mismatch is surfaced, not merged; a failed run can be retried only via a
  new operation; no fixture path writes task status, evidence or receipts.

## Why it is blocked

Applying this needs a reviewed schema change to `steward_agent_runs` and a new
server function. Hosted schema inspection and migrations are out of scope for
the current preview work, so the UI ships staged: actions visible, execute
disabled, reason shown.
