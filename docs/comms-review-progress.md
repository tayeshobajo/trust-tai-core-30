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
| C01 Three surfaces, one Comms | Partly implemented | Review is a real surface at `/modules/comms/review`; Conversations and Follow-ups consolidation is still mockup only |
| C02 Identity preserved, old routes resolve | Unmet | No route consolidation attempted, so nothing has been put at risk either |
| C03 Editable my read and goal | Mockup only | Editable in `/mockups/comms-next`; the real Review screen does not let a person edit the goal yet |
| C04 Full context, newest included | Verified (code) | Slice 1: newest-first window, whole messages, read window stated; `comms-judgment.test.ts`, `comms-draft.server.test.ts` |
| C05 Honest source coverage | Implemented | Slice 2: per-source status; text and Markdown parsed, every other type named unread; a source list that fails to read stops the review before the model is called |
| C06 Evidence-backed judgment | Implemented | Slice 2: a finding is discarded unless its quote is literally present in that version's body (`comms-review.server.ts`) |
| C07 Exact-version edits and re-runs | Implemented | Versions are immutable; a run, its findings and its approval are bound to one version, fingerprint and context revision (`comms-review.server.test.ts`) |
| C08 Actual sender identity | Verified (code) | Slice 1 plus slice 3: the author is resolved from the immutable version, separately from the reviewer, so an admin reviewing a teammate's draft no longer replaces the author |
| C09 Private opportunities stay private | Mockup only | Shown in `/mockups/comms-next`; the real review does not separate internal observations yet |
| C10 Humour and warmth handled distinctly | Partly implemented | Register guides and the ask gate exist in drafting; the review does not judge register, and quality is unevaluated |
| C11 Proposal consistency | Partly implemented | The reviewer is instructed to find contradictions and unsupported claims and the finding kinds exist; detection quality is unevaluated |
| C12 Explicit findings and question coverage | Implemented | Obligations extracted per source with offsets and verified against the exact draft text; semantic verdicts need live evaluation to be Verified |
| C13 Attachments as context only | Implemented | `comms-sources.ts`; nothing read becomes an outbound attachment |
| C14 Approval bound to what was reviewed | Implemented | Approval requires a completed current run, matching fingerprint and context revision, complete coverage and zero must-fix findings in any state; Codex verified the database rejects unfinished and stale approvals |
| C15 Shared approval and send enforcement | Partly implemented | Slice 3: one authority (`src/domain/comms-delivery.ts` with `comms-send-authority.server.ts`) gates Gmail, the in-app email path used by the queue and Scout outreach, and the LinkedIn mark-sent record. `comms-quick-reply` is still outside it, and the gate refuses everything until the proposed migration is applied |
| C16 Truthful delivery | Partly implemented | The attempt is claimed before the provider is called, keyed to draft plus approved payload; a lost provider answer is recorded as unknown and never retried; LinkedIn is labelled a person's attestation. Unproved against the real database until the delivery table exists |
| C17 Isolation between clients | Implemented | The voice packet no longer pulls other clients' messages as examples; style sources are separated from factual context and the absence of curated examples is stated. Regression test in `comms-review.server.test.ts` |
| C18 Follow-ups persist | Partly implemented | Unchanged |
| C19 Lessons learned from decisions | Unmet | Finding decisions are stored with a verified decider; nothing reads them back yet |
| C20 Failure states honest and specific | Partly implemented | Review and send failures each say what happened and what was not changed; a failure that cannot itself be recorded says so |
| C21 Accessibility | Partly implemented | Review is keyboard reachable and single-column at 375px; no audit run |
| C22 Evaluation evidence per run | Implemented | Provider, model, prompt version, context fingerprint, stages, latency, coverage, limitations and the exact voice profile and version, including on failed runs |

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

## Send gates: where they stand after slice 3

One authority decides every send it covers **inside this app**. It does not
govern the edge function still deployed on the shared project (see the table
below), so "one rule, every door" is not yet true of the system as a whole.
: `src/domain/comms-delivery.ts`
holds the rule, `src/lib/comms-send-authority.server.ts` gathers the facts and
owns the attempt. There is no second approval queue - suite approval and review
approval refer to the same decision record.

| Entry point | State |
| --- | --- |
| Gmail (`comms-gmail-send.server.ts`) | Gated. The approval is required after the message is fully built and before the claim; a refusal means Gmail is never called |
| Queue and Scout outreach email | Gated, and moved in-app to `/api/public/comms/send`. The old supabase/functions/comms-send edge function is no longer called by this app; undeploying it is a separate action Codex owns |
| LinkedIn mark-sent | Gated. Recording it requires a current approval, and the record is labelled a person's attestation, not a delivery by LinkedIn |
| `comms-quick-reply` | Gated. It no longer writes its own approval: the reply is saved as needing human review, bound to a review, and held unless that review's approval already covers exactly this message |
| Deployed legacy `comms-send` edge function | **Still open.** Active (v5) on the shared project and reachable with any session token. A fail-closed replacement body and deployment/test instructions are prepared (`guarded.index.ts` beside it, and `docs/comms-send-legacy-retirement.md`); deploying it is Codex's step. It is not disabled today |
| Scheduled sends | None exist in this app |

**The gate refuses everything today, deliberately.** The database cannot yet
tie a draft to the review that approved it, or an approval to the exact payload
it approved. Until
`docs/migrations/proposed/20260914170000_comms_review_delivery.sql` is reviewed
and applied by Codex, every gated path returns `capability_missing` and names
that file. Nothing is sent on an unprovable approval.

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

## 14 Sep 2026 — hardening migration persisted in the repository

The applied hardening SQL (applied by Codex as `comms_review_runs_hardened`,
atomically with the base migration) is now stored verbatim at
`docs/migrations/20260914160000_comms_review_hardening.sql`. It supersedes the
base file's permissions: `authenticated` has SELECT only on all seven review
tables, and history cannot be rewritten even through the service API. Nothing
was re-applied from here.

Application changes made to match the applied database exactly:

- Approval readiness now mirrors the database guard: every ask must be either
  answered or explicitly pending the other side's confirmation, and every
  verdict must have been reached semantically. A verdict matched only by
  wording blocks approval and says so.
- A source that contains no question at all is covered by definition, so a
  simple reply can be approved. The coverage note still says plainly that no
  ask was found — nothing asked is never reported as everything answered.
- The review run no longer sends a context revision on insert; the database
  sets it from the session under lock, so the recorded revision is the
  database's, not the application's.
- Repeated source material is folded before saving, and one obligation is
  saved per ask per run, matching the new unique keys. A repeat can no longer
  fail an entire save and leave a review with nothing to read.

Evidence: 2,801 unit tests, typecheck and build pass. Still code evidence only
— no signed-in session is available here, so no live review run, no live
approval, and no proof from this sandbox that ordinary members are read-only.
Shared-suite approval and every send path remain explicitly unmet.

## 14 Sep 2026 — Slice 2 closed out (bounded, before any send work)

Verified by Codex against the real database (not by this agent, and recorded
here as their evidence): all seven review tables grant `authenticated` SELECT
only, with no `anon` read; transaction-level tests showed a cross-session
foreign key rejected, an approval against an unfinished run rejected, a valid
approval accepted, and a stale-context approval rejected. The fixtures were
rolled back. There is still no signed-in browser here and no live evidence of
semantic review quality.

Fixed in `src/lib/comms-review.server.ts` this pass:

- Membership must say `active`. A missing or blank status is no longer read as
  permission. Covered by tests for invited, suspended, blank, absent and
  no-membership-at-all.
- A source list that cannot be read is no longer treated as no sources. The
  review stops before the run row is written and before the model is called,
  so a blind reading can never be produced.
- Reads in `loadReview` check their errors: a failed read refuses rather than
  rendering as an empty workspace with no sources, no runs and no findings.
- A failed run only claims to be recorded as failed when that write actually
  succeeded; otherwise it says the record may still show it as running.
- The reviewer is now given the verified author, read from that person's own
  profile, and the workspace's stored Voice DNA with its version, plus up to
  three already approved or sent messages as illustration. Tai's signature is
  never substituted. When no rules can be read, the packet says so instead of
  claiming a calibrated voice, and the run records `voice_profile:none`.
  Voice suggestions remain proposals: nothing here writes to the voice rules.
- The context race is closed. The database stamps the run's revision at
  insertion; if it differs from the revision read a moment earlier, the run is
  marked failed with `context_changed` and nothing is judged.
- The fingerprint now covers the situation, the verified sender and the exact
  voice version as well as the words, recipient, goal and sources, and is
  built identically in `runReview` and `loadReview`. An edited goal or a new
  voice version invalidates old evidence.

Evidence: `src/lib/comms-review.server.test.ts` — 14 boundary tests over a
fake Supabase and a fake model: successful persistence and ordering, failed
source read, failed evidence insert never completing, unrecordable failure,
missing service key, each inactive membership shape, wrong workspace, the
startup context race, the real voice packet, and the honest fallback. Full
suite, typecheck and build pass. This is code evidence; no live run.

Proposed, NOT applied: `docs/migrations/proposed/comms-review-provenance.sql`
adds `voice_profile_id`/`voice_version` to runs and `context_revision` to
approvals. The application works unchanged without it.

Send gates still open, unchanged by this slice: `comms-quick-reply`,
`supabase/functions/comms-send` (reads `comms_drafts.review_state`, a
different record), `comms-linkedin-send.server.ts`, any scheduled send, and
the shared suite approvals surface. No send path reads a review approval.

## 14 Sep 2026 — Slice 3 completion pass (after independent review of 51acd8a)

Corrected in this pass:

- **Binding is real.** A review can be created for a draft, carrying the draft,
  the channel it is meant to leave by and the sending identity. Approval then
  derives the outbound payload on the server from the draft on record — never
  from the browser — refuses when the draft no longer says what the review
  read, and records the payload fingerprint and channel on the approval.
- **Findings are read by their real column.** The gate selects `severity, why`;
  `summary` does not exist in the applied schema.
- **Current context is recomputed, not borrowed.** The gate rebuilds the
  fingerprint through the shared review loader from the current version, the
  current sources, the situation, the verified author and the stored voice
  rules, and compares the approval against that. A voice rule edited after
  approval now invalidates it. Closed reviews are ignored; two open reviews of
  one draft are an explicit refusal; the approval must name this review, and
  the run must be this review's run of this approval's version.
- **The payload fingerprint is collision-resistant.** SHA-256 over a canonical,
  length-prefixed encoding of the exact provider payload — channel, normalised
  subject and body, recipient, cc, bcc, sending identity and, per attachment,
  name, type, size and content or immutable storage identity. A replacement
  file of the same length invalidates the approval. Approval, the gate and
  every dispatch path build it through one helper.
- **Claiming is strict.** Only a unique violation whose existing row is this
  same draft, approval, payload and channel counts as a replay; every other
  insert failure refuses and reaches no provider. A claim that returns no
  identifier refuses. Settling only moves an attempt still in flight, verifies
  exactly one row moved, and says plainly when a receipt could not be stored
  instead of claiming it was.
- **Quick reply** is inside the gate (see the table above).

Evidence: `src/lib/comms-send-authority.server.test.ts` (21 tests: the approved
path calls the provider exactly once and records the attempt first; refusals
for no review, no approval, unfinished review, edited words, moved voice or
material, revised conversation, newer version, two open reviews, an approval
from another review, a run of another version, view-only role, inactive or
absent membership, missing server credentials; duplicate claim; provider
refusal; lost answer; unstorable receipt) and
`src/lib/comms-review-approval.server.test.ts` (the positive binding →
approval → fingerprint path, and the refusal when the draft drifted). Every
double answers with columns the applied schema actually has.

Still not done, and not claimed:

- `docs/migrations/proposed/20260914170000_comms_review_delivery.sql` is
  **proposed, not applied**. It now carries service-role grants and a PUBLIC
  revoke, same-organization composite bindings for draft, session, approval and
  delivery, immutable delivery identity with one-way outcomes,
  `unique (organization_id, draft_id, payload_fingerprint)` independent of the
  caller's key, a database-stamped approval revision (bigint, matching
  sessions), frozen voice provenance on runs, and a claim-time trigger that
  revalidates the same invariant the server checks while holding the session
  row locked.
- The deployed legacy send function is still active.
- Nothing here has been proved against the live database, and no message has
  been sent to anybody.
