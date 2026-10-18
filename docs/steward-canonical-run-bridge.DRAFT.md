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
5. Idempotency: `steward-canonical:{org}:{task}:{action}:v1` key; retry
   returns the existing run, never reruns the model on reconcile.
6. Bounded actions v1: `prepare_brief`, `draft_roadmap`, `prepare_handoff`,
   `review_output` — each mapped to a fixed instruction template with no new
   external tools and `webSearch: false`.

## Why it is blocked

Applying this needs a reviewed schema change to `steward_agent_runs` and a new
server function. Hosted schema inspection and migrations are out of scope for
the current preview work, so the UI ships staged: actions visible, execute
disabled, reason shown.
