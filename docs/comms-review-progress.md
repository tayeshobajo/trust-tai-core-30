# Comms review upgrade: progress and criterion evidence

Source brief: `docs/comms-review-brief.md`. Acceptance contract:
`docs/comms-review-acceptance.md` (canonical C01–C22 definitions).
Updated 14 September 2026.

Stage: **2 of 4 — slice 2 built. Review runs on real records.**

Honesty rules for this file. A criterion is only Verified when there is
evidence a person can open. Code evidence (unit tests, typecheck, build) is
never reported as live evaluation (a signed-in person, real records, a real
model run). Prototype behaviour in `/mockups/comms-next` is scripted and is
named as such. Rendering inside `AppShell` does not establish authentication;
`WorkspaceGate` plus a server-verified active membership does.

## C01–C22 assessment

States are defined in `docs/comms-review-acceptance.md`.

| Gate | State | Evidence |
| --- | --- | --- |
| C01 Three surfaces, one Comms | Partly implemented | Review now exists as a real surface at `/modules/comms/review`; Conversations and Follow-ups consolidation is still mockup only |
| C02 Identity preserved, old routes resolve | Unmet | No route consolidation attempted yet, so nothing has been put at risk either |
| C03 One readable conversation view | Mockup only | `/mockups/comms-next` |
| C04 Full context, newest included | Verified (code) | Slice 1: newest-first window, whole messages, read window stated; `comms-judgment.test.ts`, `comms-draft.server.test.ts` |
| C05 Explicit question coverage | Implemented | Slice 2: obligations extracted per source with offsets, verified per draft version, shown in Review. Semantic verdicts require live evaluation to be Verified |
| C06 Evidence-backed findings | Implemented | Slice 2: a finding is discarded unless its quote is literally present in that version's body (`comms-review.server.ts`) |
| C07 Conflict and unsupported-claim detection | Partly implemented | The reviewer is instructed to find them and the finding kinds exist; detection quality is unevaluated |
| C08 Actual sender identity | Verified (code) | Slice 1: `comms-sender.ts`, `comms-sender.test.ts` |
| C09 Attachments as context only | Implemented | Slice 2: `comms-sources.ts` reads text and Markdown, names every other type unread, and nothing becomes an outbound attachment; `comms-sources.test.ts` |
| C10 Shared approval across entry points | Unmet | `comms-quick-reply` still bypasses review. See "Send gates still open" |
| C11 Version-bound, idempotent delivery | Partly implemented | Approval is version-bound and context-bound (`comms-review.ts`, `comms-review.test.ts`); no send path reads it yet |
| C12 Honest incompleteness | Implemented | Source coverage note plus per-source status on the Review screen; unverifiable answers stay uncertain |
| C13 Warm and complaint registers | Partly implemented | Register guides and ask gate exist in drafting; review does not yet judge register |
| C14 Voice rules enforced deterministically | Partly implemented | Voice pass runs; signature is per sender |
| C15 Human correction respected | Partly implemented | Corrections outrank inference in retrieval; finding decisions are recorded but do not yet feed later runs |
| C16 Follow-ups persist | Partly implemented | Unchanged this slice |
| C17 Lessons learned from decisions | Unmet | Finding decisions are stored; nothing reads them back yet |
| C18 Accessibility | Partly implemented | Review is keyboard reachable and single-column at 375px; no audit run |
| C19 Failure states honest and specific | Partly implemented | Review has typed failures (provider unavailable, unreadable review, stale version, approval refused), each saying what was not changed; send failures do not exist yet |
| C20 No autonomous send | Verified (code) | No send path exists in `comms-review.server.ts`; approval records a decision only |
| C21 Follow-ups surface | Mockup only | |
| C22 Evaluation evidence per run | Implemented | Slice 2: every run row carries provider, model, prompt version, context fingerprint, stages, latency, coverage and limitations, including failed runs |

## Slice 1: truthful context and the real sender

Shipped. No new tables, no interface redesign.

- `src/lib/comms-draft.server.ts` reads the conversation newest first with an
  exact message count.
- `src/domain/comms-judgment.ts` keeps a message whole and states coverage.
- `src/domain/comms-coverage.ts` extracts asks with positions, rule-based and
  labelled as such.
- `src/domain/comms-sender.ts` signs a message with its actual author.

## Slice 2: review runs on real records

Built. What it adds:

- **Migration** `docs/migrations/20260914150000_comms_review_runs.sql`: seven
  tables — sessions, immutable versions, sources, runs, findings, obligations,
  approvals — with composite organization-consistent foreign keys, explicit
  grants, RLS on every table, and triggers that freeze run identity, restrict
  findings to their decision fields, and force an approval to name the
  authenticated approver. No `SECURITY DEFINER`, no change to existing
  relationships, messages or drafts.
- **Sources read honestly** (`src/domain/comms-sources.ts`): pasted text and
  text/Markdown files are parsed; PDFs, images, spreadsheets and email exports
  are listed with a plain statement that nothing in them was used.
- **Obligations, verified** (`src/domain/comms-obligations.ts`): the lexical
  keyword heuristic is retained only as a labelled candidate hint and can
  never mark anything answered. A semantic verdict survives only when the
  passage it quotes is genuinely in that exact draft version and is not a
  restatement of the question. Everything else stays uncertain.
- **Version and approval law** (`src/domain/comms-review.ts`): a run is bound
  to one version; an approval names a person, a version and a context
  fingerprint over the words, recipient, goal, sender and source set. Any
  movement makes it stale. Approval is owner or admin only, enforced in the
  database as well as in code.
- **The room**: `/modules/comms/review`, reached from the Comms tabs.

Tests: `comms-obligations.test.ts` (15, including the adversarial set —
repeated question, unrelated keyword overlap, paraphrased valid answer,
multiple asks in one sentence, pending on only one of several asks, no-ask
source, late question, hallucinated obligation id, unverifiable quote),
`comms-review.test.ts` (11), `comms-sources.test.ts` (9).

## Send gates still open

Nothing in slice 2 opens a send path, and no send path reads the new
approvals. These remain to be bound to review before C10 and C11 can be met:

1. `comms-quick-reply` — replies without any review.
2. `supabase/functions/comms-send` — sends from `comms_drafts.review_state`,
   which is a different approval record from the one this slice writes.
3. `comms-linkedin-send.server.ts` — its own approval path.
4. Any future scheduled send.

## Hardening after independent review (14 September, later)

An independent review of the base migration and server found that ordinary
members could have written review runs, findings, obligations and approvals
directly, which would have made every "the AI found this" record forgeable.
The corrections, all in application code (the base migration file was left
untouched while Codex reviewed it):

- **Writes moved behind the server.** Reads still run as the caller under RLS;
  writes now use the server's service credentials, and only after this code
  has proved a real session, an active membership of that exact organization,
  and the session, version and role the request claims. Missing service
  credentials fail loudly; there is no fallback to the browser key, and the
  key is never returned or logged.
- **Every read carries the organization.** A person can belong to several
  workspaces, so a session id alone never reaches across one.
- **No swallowed writes.** A run whose findings or coverage could not be
  stored is recorded as failed, not complete, and says so.
- **Approval has a real gate.** Approving requires a completed review of
  exactly this version, fingerprint and context revision, bound to that run's
  id; every source read; every obligation answered; and zero must-fix
  findings on that review. Accepting or keeping a must fix does not clear it:
  only changed words and a fresh review that no longer raises it do. A
  missing review is never treated as optional.
- **Decisions carry a person.** A finding decision is written with the
  decider's verified id and the time, taken from the session, never from the
  request body.
- **Context revision.** Approval staleness no longer rests on the version id
  alone: the session carries a revision that the database bumps when a
  version, a source, or the goal, recipient or situation changes, and both the
  run and the approval record it.
- **Truthful stages.** One model call is recorded as one model call. The
  stages either side of it are named as code, not as AI passes.

Dependency: the follow-up hardening migration Codex is authoring must revoke
all `authenticated` writes on the seven review tables (keeping
organization-scoped SELECT), add `session_id` to findings, add `session_id`,
`version_id`, `obligation_key` and `excerpt_start`/`excerpt_end` to
obligations (replacing `source_start`/`source_end`), add `decided_by` and
`decided_at` to findings, and add `context_revision` to sessions, runs and
approvals with the triggers that maintain and enforce it. The application code above is
written against exactly those names. Until both migrations are applied the
Review page cannot save anything, and says so.

## Not yet proved

- No live model run has been made from this code. Everything above is code
  and unit-test evidence.
- The lexical keyword heuristic produced a reproducible false positive in
  independent testing. It is retained only as a labelled candidate hint and
  is never consulted for coverage or readiness.
- Quoted-answer verification proves that a claimed answer is really in the
  draft. It does not prove that every implicit request in a message was
  found. That limitation stays stated in the interface and here.
- Suite-wide approval and send integration is explicitly **unmet**. This is a
  review-approval record only. `comms-quick-reply`, `comms-send`, the LinkedIn
  send path and the suite approvals surface neither read nor require it.

## Applied, and what was checked against the real database

Codex applied the base and hardening migrations atomically to
`okydosoacqdnursmmenf` as `comms_review_runs_hardened` on 14 September 2026.

Checked directly against the live database on the same day: all seven tables
exist and respond, and every column this application writes is present —
including `findings.decided_by` / `decided_at`, the renamed
`obligations.excerpt_start` / `excerpt_end`, `obligations.obligation_key`,
and `context_revision` on sessions and runs.

One difference from the specification, found by that check and worked around
in the application rather than by changing SQL: **`comms_review_approvals`
has no `context_revision` column**. An approval is bound to the run it was
given against, and that run carries the revision, so approval staleness is
read back through the run. The guarantee is unchanged; if Codex later adds
the column, the read can be simplified. Nothing writes the missing column, so
approvals do not fail.

Not yet checked against the live database: that the `authenticated` role
really has SELECT only (that needs a real member's token), and any end-to-end
write. No rows have been written to the workspace from this code.

## Next backend step

(Completed — kept for the record.) Apply the base migration `docs/migrations/20260914150000_comms_review_runs.sql`
together with Codex's follow-up hardening migration, atomically, to the
existing external Supabase project `okydosoacqdnursmmenf`. The base file is
unchanged. Both are additive.

Server configuration: the Review page writes with
`TRUST_TAI_SUPABASE_SERVICE_KEY`, falling back to `SUPABASE_SERVICE_ROLE_KEY`,
against the existing project URL. If neither is present on the server, review
intake, runs and approvals fail with an honest "not configured" message rather
than writing anything. Until it is applied, `/modules/comms/review` will report an honest
failure rather than showing anything invented.

To verify after applying:

1. Open `/modules/comms/review` signed in, paste a message with two questions
   in it, write a reply that answers one, and run the review. Expect one ask
   answered with a quote from your own words, and one still open.
2. Edit the reply and save. The review should say it is out of date, and any
   approval should say the draft changed since it was approved.
3. Sign in as a member who is not an owner or admin. Approval should be
   refused, in the interface and at the database.
4. Attach a PDF. It should appear in "What Comms read" as not read, and the
   coverage line should say so.
