# Comms — the eight-round pack

Tai authorised running the eight rounds in sequence. This file carries the
shared instructions once, then one section per round.

## Shared instructions (apply to every round)

- Project `65944e34-ede5-4757-befb-870e1ff97444`, repository
  `tayeshobajo/trust-tai-core-30`, existing external Supabase project
  `okydosoacqdnursmmenf`. Lovable Cloud is never enabled here.
- Preserve the approved `/mockups/comms-workspace-v2` direction and the five
  destinations: Dashboard, Conversations, Drafts & Reviews, Voice DNA,
  Connections, with New draft (Message / Email / Proposal) always visible.
- Preserve the OS typography and visual language. The marketing site's design
  system is not substituted.
- `docs/comms-tab-integration.md` (T01–T05), `docs/comms-review-progress.md`
  and `docs/comms-review-acceptance.md` (C01–C22) keep their canonical
  definitions. Evidence is added against them; no ID is redefined to make a
  feature pass.
- Preserve record IDs, history, organisation boundaries, real author /
  reviewer / sending identity, immutable versions, source provenance, context
  revisions, one approval authority and idempotent delivery. Reuse existing
  services: no second queue, second store or parallel draft model.
- Migrations for review, delivery and kind/structured-source are already
  applied. Inspect actual migration history before proposing anything further;
  new SQL goes to Codex for review, is never applied here, and applied files
  are never reapplied or reset.
- No production publish and no message sent during these eight rounds.
  Preview preparation and synthetic no-send QA are allowed. Real client threads
  and the workspace's Voice DNA are not altered to produce evidence.
- Historical evidence preserved untouched: QA review session
  `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f`, run
  `b7bee2e2-4b13-476e-9f61-af008d374215`.
- Evidence labels: **Implemented**, **Code-tested**, **Live-verified**,
  **Tai-accepted**, **Blocked**, **Not applicable with reason**. A blocked,
  skipped or mocked check is never reported as a pass.

## Round 1 — Finish Conversations and lock the workspace

Date 2026-09-15. Environment: Lovable sandbox, dev server on localhost, no
signed-in session (`LOVABLE_BROWSER_AUTH_STATUS=no_supabase`). Nothing
published, nothing sent, no schema change proposed or applied.

### Outcome

Conversations is now the working room the approved direction described: a
compact header with the five tabs, the list of people, and one focused pane
holding the latest exchange, the editable goal, the reply editor and the
primary action. Earlier history is real records one click away. Failed reads
are visible as unavailable rather than a quiet thread. Unsaved writing is
protected with a real choice, and a narrow screen opens one conversation at a
time with a way back.

### Changed files

| File                                                 | Change                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/components/tt/comms/conversation-room.tsx`      | `historyGaps` / `onRetryHistory` notice above the thread; `onBack` control for narrow screens; the "nothing on record" line is suppressed whenever a read failed.                                                                                                                                                                          |
| `src/routes/modules.comms.relationships.tsx`         | Per-read gap derivation from the touches / messages / drafts queries; retry refetches all three; person switching goes through `openRelationship`, which asks before discarding unsent writing; `useBlocker({ withResolver: true })` with an in-room Stay / Discard dialog replacing `window.confirm`; mobile pane state for list-or-room. |
| `src/components/tt/comms/conversation-room.test.tsx` | New: four focused checks (added this round).                                                                                                                                                                                                                                                                                               |
| `docs/comms-eight-rounds-progress.md`                | This file.                                                                                                                                                                                                                                                                                                                                 |

No service, schema, identity, approval or delivery code was touched. No change
outside Comms.

### Acceptance

| ID   | Evidence                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1.1 | **Implemented** · live **Blocked**         | No hero. Header row + tabs ≈ 110px, then list and room at `calc(100dvh-190px)`, so at 1440×900 the latest exchange, goal row, reply editor and "Review this draft" sit inside the viewport. Measurement in the signed-in app is blocked.                                                                                                                                                                            |
| P1.2 | **Implemented** (pre-existing, re-checked) | Search, tab and health filters derive over the whole accessible set (`inboxView`), paging renders only; `?relationship=<id>` seeds the selection and `/modules/comms/conversations` redirects preserving it. Not live-verified.                                                                                                                                                                                     |
| P1.3 | **Code-tested**                            | `conversation-room.test.tsx`: a failed read renders "Part of this history could not be read" with the source and message and **no** empty-thread line; an all-succeeded empty thread still says so. Earlier days stay reachable behind a real count and appear on click.                                                                                                                                            |
| P1.4 | **Implemented** · live **Blocked**         | Save → "Review this draft" calls the existing `openReview(draftId, organizationId)` and navigates to `/modules/comms/drafts?session=…`; the drafts workspace resolves the exact record (covered by `drafts-workspace.test.tsx`). One review, one approval, authorship untouched. Round-trip against persisted records is blocked.                                                                                   |
| P1.5 | **Implemented**, partly **Code-tested**    | Tab, person, record and browser-back departures with unsent writing open a Stay / Discard dialog; reload is covered by `enableBeforeUnload`. Save is **Not applicable with reason**: reply text becomes a record only by preparing a draft (a model call), so the dialog says plainly that the text is not saved yet instead of offering a save that does not exist. A failed prepare keeps the text in the editor. |
| P1.6 | **Implemented** (pre-existing, re-checked) | Close/reopen writes through `setConversationClosed`; follow-up settle/remind/not-needed go through the existing relationship mutations; Scout and Roadmap handoffs keep their existing identity and readiness gate. Not live-verified.                                                                                                                                                                              |
| P1.7 | **Implemented** · live **Blocked**         | Under `lg`, list and room are alternate panes; selecting a person opens the room, "← All people" returns. The back control is covered by a focused test; the responsive behaviour itself is CSS and needs a device check.                                                                                                                                                                                           |

### Tests

`bunx vitest run src/components/tt/comms/conversation-room.test.tsx
src/components/tt/comms/drafts-workspace.test.tsx` — 2 files, 9 tests, passing
(2026-09-15). `bunx tsgo --noEmit` clean; build OK.

### Screenshots

None added this round. The only production screen this environment can reach
is the signed-out gate (`/tmp/browser/t02/prod-signedout-desktop.png`), and a
fixture screenshot would not be evidence for a production acceptance row.

### Unresolved

1. **No signed-in environment.** Every row marked live is blocked. Impact: P1.1,
   P1.2, P1.4, P1.6, P1.7 have code evidence only.
2. **AI review has never succeeded.** Unchanged from
   `docs/comms-release-readiness.md`; not touched this round.

### Exact next action

Round 2 must supply the signed-in preview: confirm
`https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app` serves
this build, sign in there, and close P1.1, P1.2, P1.4, P1.6 and P1.7 against
persisted records with desktop and mobile captures. No send.

## Round 2 — Establish the preview and resolve the AI failure

Date 2026-09-15. Commit at the start of the round
`7e00a463446ae7366dc3574fcdb9de6268c8b719`. Environment: Lovable sandbox with
the project's server secrets present; no Cloud Browser session (Codex is
checking that separately). Nothing published, nothing sent, no schema change,
no model or provider configuration changed, historical QA records untouched.

### The cause of `provider_call_failed`, found and corrected

The four layers were separated and tested one at a time.

1. **Configuration** — present and correct. `OPENAI_API_KEY` and
   `LOVABLE_API_KEY` both exist in the project's secrets; no
   `SCOUT_DISCOVERY_MODEL` / `SCOUT_OPENAI_MODEL` override, so the review runs
   direct OpenAI `gpt-5-mini`, with the Lovable gateway (`openai/gpt-5-mini`)
   as the configured fallback. Nothing was changed here.
2. **Transport / provider** — this is the fault. Replaying the review's exact
   request shape with a synthetic packet (no client text) returned
   **HTTP 400, `invalid_request_error`, param `input`**: the Responses API
   refuses `text.format: json_object` unless the word "json" appears in the
   **input** messages. The review's instructions say "Return strict JSON only",
   but instructions do not count, and a review packet is data that rarely
   happens to contain the word. So the call was rejected before any reasoning
   started — which is also why the gateway logs show zero requests: a 400 is
   not one of the recoverable cases the fallback retries, so the second
   provider was never tried.
3. **Output parsing** — not reached in the original failure, and healthy once
   the call goes through: the reply parsed as strict JSON on first attempt.
4. **Persistence** — worked. The original failure was saved
   (run `b7bee2e2-4b13-476e-9f61-af008d374215`, `provider_call_failed`), which
   is how the cause could be traced at all.

A second, independent fact surfaced during the probe: the **direct OpenAI key
has no credits** (`credit_balance_exhausted` on a streamed `response.failed`).
That is a billing state, not the bug, and the existing fallback already treats
a credit/quota message as recoverable and retries on the gateway.

**The correction** (smallest change, no requirement weakened, no model
switched, no fake output): `src/lib/roadmap-research.server.ts` now prefixes a
single framing line, "Reply with json only.", to the input whenever — and only
whenever — it is sending the default `json_object` format and the input does
not already contain the word. Packets are otherwise untouched, callers with
their own strict schema are untouched, and web-search calls are untouched.

### Changed files

| File                                           | Change                                                          |
| ---------------------------------------------- | --------------------------------------------------------------- |
| `src/lib/roadmap-research.server.ts`           | `inputForJsonObjectFormat` and its use in `runProviderCall`.    |
| `src/lib/roadmap-research.json-format.test.ts` | New: framing added when absent, packet left alone when present. |
| `docs/comms-eight-rounds-progress.md`          | This section.                                                   |

No review, approval, delivery, identity or schema code touched.

### Acceptance

| ID   | Evidence                                   | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P2.1 | **Blocked** (partly **Implemented**)       | Preview `https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app` answers `401` until Lovable sign-in; published `https://trusttai-os-foundation.lovable.app` answers `302`. No hostname was invented and no hosted build identity is claimed: this environment has no signed-in session, so the served build cannot be read. Local build identity is commit `7e00a46…` plus this round's change. Authentication against the authorized workspace is the exact blocking dependency.                                                                                                                                                                                                                           |
| P2.2 | **Partly live-verified · not passed**      | A real model response, through the Lovable gateway with `openai/gpt-5-mini` and the review's real instructions, completed and returned strict JSON on the QA fixture: 2 findings, obligation `q2` (who sends the handover guide) status **missing** — the fixture's required flag. Corrected draft re-run: `q2` **answered**, the missing-answer finding cleared, with no invented date, price or commitment (the third finding asks who "I" refers to, which is a real identity question, not an invented one). This is a direct transport probe with a synthetic packet, **not** a persisted review run in the workspace, so P2.2 is **not** passed: findings, coverage and provenance were not written to the database. |
| P2.3 | **Blocked**                                | Provenance columns are only populated by a real persisted run, which needs the signed-in session. Nothing about provider/model, prompt version, voice profile/version, rules snapshot or SHA-256 is claimed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| P2.4 | **Code-tested** (pre-existing, re-checked) | `comms-review.server.test.ts` (20 tests, passing) covers forced provider failure and forced evidence-insert failure: the run is marked failed, approval stays unavailable, and the message states whether the failure record itself was saved.                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| P2.5 | **Code-tested** (pre-existing, re-checked) | A source-read error returns before the provider call; obligation coverage is `evaluated: false` on a failed or unrun review, so the surface says **Not evaluated**, never "no questions found".                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| P2.6 | **Implemented**                            | Connections keeps three separate facts: configured model, a completed local evaluation, and per-draft readiness. This round adds nothing to any of them: configuration was already present while every real run still failed, which is the point.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

### Tests

`bunx vitest run src/lib/roadmap-research.json-format.test.ts
src/lib/comms-review.server.test.ts` — 2 files, 22 tests, passing.
`bunx tsgo --noEmit` clean. Probe scripts were throwaway (`/tmp`), used
synthetic text only, and no credential or raw provider body is recorded here
beyond the sanitized status and error code.

### Unresolved

1. **No signed-in session** — P2.1, P2.2 and P2.3 cannot close. Precise
   dependency: an authenticated session on the preview host for the authorized
   workspace. Safe next action: Codex runs one synthetic QA review there on
   this build and reports the persisted run id.
2. **AI is still not called functional.** The 400 is corrected and a real model
   response was obtained out-of-band, but no review has yet completed and
   persisted inside the workspace.
3. **The direct OpenAI key has no credits.** Until it is topped up, every
   review will run on the gateway fallback. Worth deciding deliberately rather
   than discovering in provenance.
4. **Round 1 P1 live checks remain BLOCKED**, and P1.5 remains an explicit gap:
   there is no raw-draft save, so save/recovery acceptance is not met — carried
   to Round 3.

### Exact next action

Sign in on the preview, run one synthetic QA review on this build, and read the
persisted run: provider, model, prompt version, voice profile and version,
rules snapshot and checksum. That closes P2.1–P2.3 or names the next fault.

### Round 2 addendum — independent browser evidence (15:27 UTC, 2026-09-15)

Correction to the round 2 table above: **a signed-in browser session does
exist.** The earlier "no signed-in session" wording describes this sandbox
only, which has no browser transport to the workspace. Codex signed in to the
preview as Tai independently.

What Codex observed there (independent evidence, not reproduced here):

- Dashboard loaded real scoped work: 5 replies owed, 44 waiting drafts, one
  historical QA review.
- A **new** synthetic intake was started through the New draft menu:
  title "QA ROUND 2 - two questions - do not send", recipient QA Sample Client
  `qa-comms@example.invalid`, source asking the training day and the handover
  owner (confirmed: Tuesday; Tai), draft answering Tuesday only.
- "Open message review" was clicked once. No model button was clicked, no
  approval, no send.
- The browser's CDP get/refresh then timed out twice; browser transport is
  currently unavailable. Database persistence of the intake is being checked by
  Codex.

Consequences to hold onto:

1. **Do not create this intake again.** One QA ROUND 2 record may already
   exist; a second would be a duplicate, not evidence.
2. **That preview build predates this round's correction.** The
   `json_object` framing fix is in the working tree at this commit and was not
   in the build Codex used, so a review run started there would still be
   refused with the same 400. P2.2 and P2.3 close only on a build that carries
   the fix.
3. P2.1 is therefore **partly live-verified**: authentication against the
   authorized workspace works and the preview serves real scoped data. The
   exact build identity behind that session is still unrecorded, so P2.1 is not
   yet fully closed.

Revised next action: deploy or refresh the preview onto a build containing the
`inputForJsonObjectFormat` correction, then run the model on the **existing**
QA ROUND 2 record and read the persisted run's provider, model, prompt version,
voice profile/version, rules snapshot and checksum. No send, no approval.

## Round 3 — Drafts and proposals under real use

Commit base: round 2 working tree. Environment: Lovable sandbox, no browser
transport to the workspace (`LOVABLE_BROWSER_AUTH_STATUS=no_supabase`).
Date: 2026-09-15. Queue authorization: Tai authorized rounds 3–8 in order;
acceptance gates are unchanged, so blocked rows stay blocked.

### Inspected before changing anything

Read-only reads against `okydosoacqdnursmmenf` with no writes:

- `comms_review_sessions.kind` and `comms_review_versions.structured_source`
  both select successfully (HTTP 200) — the applied migrations are present.
  No schema change was made or proposed this round.
- Round 2 QA session `2419b89e-f1da-4f7b-95b3-21fd3e15493f`: kind `message`,
  status `open`, context revision 2, created 15:24:25Z; one version
  `4a11e9d6-6d56-4b1f-8c99-751ec077daaa` (version 1, `structured_source` null,
  correct for a message); zero rows in `comms_review_runs`. Matches Codex's
  SQL check exactly. Untouched, not recreated.

### Changed

- `src/lib/comms-review.server.ts` — `listReviews` swallowed its read error and
  returned `[]`, which reached the queue as a confident "nothing waiting". It
  now raises `review_unreadable`. Partial-save disclosure on a failed source
  insert now names the session that does exist instead of implying the draft
  went nowhere.
- `src/components/tt/comms/review-workspace.tsx` — proposal scope, pricing and
  missing-detail issues are listed beside the editor, blocking ones marked. On
  converting to plain text with a blocking issue open, it says plainly that the
  rewrite does not settle it and that nothing checks the numbers afterwards.
- `src/domain/comms-proposal.test.ts`, `src/lib/comms-review.server.test.ts` —
  new checks below.

### Acceptance

| ID   | Evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P3.1 | **Implemented / Code-tested.** Kind, recipient, goal, situation and body persist per session and version; `kind` column confirmed live. No live save/reload — **Blocked** on a signed-in browser.                                                                                                                                                                                         |
| P3.2 | **Code-tested.** Sections round-trip through `structuredProposalSource` / `readStructuredSource`; versions are insert-only, so older ones cannot change. Live restore **Blocked**.                                                                                                                                                                                                        |
| P3.3 | **Code-tested.** Text is rendered server-side from sections (`canonicalBody`); stored text disagreeing with stored sections reads as not reconstructable; malformed structure is refused before any first write, at every server entrypoint.                                                                                                                                              |
| P3.4 | **Code-tested.** New test: 2 × USD 125.50 + 1 × 249.00 − 50.00 = `USD 450.00` in exact minor units. Blank price leaves the total null and names the unpriced line. One currency per proposal, so mixing is not representable. Zero-decimal currencies: **Not applicable with reason** — none of GBP/USD/EUR/NGN is zero-decimal, and a new test asserts that, so adding one fails loudly. |
| P3.5 | **Implemented / Code-tested.** Issues are listed with blocking ones marked, and a plain-text rewrite is told it settles nothing.                                                                                                                                                                                                                                                          |
| P3.6 | **Implemented** (unchanged this round): source material and outbound attachments are separate records; unsupported extraction is labelled per source. Live **Blocked**.                                                                                                                                                                                                                   |
| P3.7 | **Implemented / Code-tested.** Failed list read now refuses instead of listing none (2 new tests). Capped lists are labelled; bound deep links fetch the exact record rather than search a page.                                                                                                                                                                                          |
| P3.8 | **Implemented.** A failed version insert names the empty review left open; a failed source insert now names the recorded draft. Writing stays in the editor on a failed save. Live interrupted-save **Blocked**.                                                                                                                                                                          |

### Tests

`bunx vitest run src/domain/comms-proposal.test.ts
src/domain/comms-proposal-source.test.ts src/lib/comms-review.server.test.ts`
— 3 files, 41 tests, passing. Types and build clean.

### Unresolved and next dependencies

- No live save/reload evidence for any of the three types: needs a signed-in
  browser on a build carrying round 2's `json_object` correction. This is the
  gate for P3.1, P3.2, P3.6, P3.8 and for round 2's P2.1–P2.3.
- P1.5's missing raw-draft save is still an open product gap, carried forward.
- No run has been made on the QA session, so no provider/fallback has been
  recorded yet. When one is: record provider, model and whether the direct key
  or the gateway answered, and keep the exhausted-credit constraint separate
  from the request-format defect that round 2 fixed.

## Round 4 — Voice and judgment, measured against a fixed set

Environment: Lovable sandbox, 2026-09-15. Model calls in this round went to
the Lovable AI Gateway on `openai/gpt-5-mini` — the same model the review
falls back to — with the real reviewer instructions read out of the source
file, never a paraphrase. Synthetic material only: no workspace record, no
client thread, no Voice DNA row was read or written, and nothing was sent.

### The fixed set

`src/domain/comms-review-eval.ts` holds 13 cases, written with their expected
outcome before anything was run, each naming the failure it exists to catch:
buried question, request without a question mark, ambiguous deadline,
unsupported commitment, pricing mismatch, conflicting old and new facts, warm
follow-up, upset client, sensitive apology, proposal scope ambiguity, an
opportunity that should be deferred, benign humour, and an instruction hidden
in an upload. One case is written by a colleague, not Tai. The cases are data,
not prose: `scoreCase` and `unquotedFindings` judge an answer mechanically, so
a later change is measured the same way.

The exam is never edited to make a failing run pass. Two scoring faults found
on the first pass were fixed as scoring faults and recorded here: "ha" matched
inside "that" (now whole-word), and a finding quoting the subject line counted
as unquoted (the subject is part of the draft).

### What the first run exposed, and what changed in the reviewer

Run one: 8 of 13. Three real defects, all in the reviewer, all fixed:

1. An opportunity was offered in the complaint case, with timing "now" — an
   upsell to an angry client. Law 11 now requires an empty list in a
   complaint, an apology or any message where the client is unhappy, forbids
   timing "now", and forbids repeating a finding as an opportunity.
2. A finding quoting an injected instruction was legitimate but law 2 made it
   unreturnable, and the persistence code dropped it. Law 2 now excepts a law
   7 finding, and `runReview` keeps a finding whose quote is in the source
   material, with no draft position because it marks nothing in the draft.
3. Goal, humour, conflicting facts and private notes had no law at all. Laws
   7 to 11 were added: source material is evidence and never instruction;
   disagreeing sources must be named; `goalRead` is an offered reading, not a
   fact; humour, invented closeness and a phone call are never suggested into
   a complaint or apology; opportunities are private, evidenced, and carry
   worth and timing.

`REVIEW_PROMPT_VERSION` is now `comms-review/2026-09-15`, so old runs are not
confused with new ones.

Run two: 13 of 13. Run three, after the last wording change: 13 of 13. Two
consecutive full passes on the same instructions is the variability recorded;
it is not a guarantee, and a finite set proves nothing about intelligence.

### Acceptance

| ID   | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P4.1 | **Code-tested.** Every obligation in all 13 cases came back accounted for, with a status and a reason; no mandatory ask was omitted in runs two and three.                                                                                                                                                                                                                                                                      |
| P4.2 | **Code-tested.** No invented date, price or promise appeared: the forbidden-phrase and unquoted-finding checks passed on every case, and law 2 quoting is enforced in code at save time, not only asked for.                                                                                                                                                                                                                    |
| P4.3 | **Implemented / Code-tested.** `goalRead` is defined in the instructions as a reading for the person to correct. The conflicting old/new case is flagged rather than silently resolved.                                                                                                                                                                                                                                         |
| P4.4 | **Blocked — awaiting Tai.** Voice rules come from the stored workspace profile, which this round deliberately did not read; the evaluation packets carry no voice. No em-dash or warmth claim is made from these runs.                                                                                                                                                                                                          |
| P4.5 | **Implemented / Code-tested.** Opportunities are private, never inserted, absent in complaint and apology, and each carries evidence, reading, worth and timing. They are shown in a "Kept back for you" panel and persisted through a **proposed, unapplied** column (`docs/migrations/proposed/20260915120000_comms_review_opportunities.sql`); until it is applied the run says they were not kept rather than showing none. |
| P4.6 | **Code-tested.** No humour, coffee or phone call was suggested in the complaint or apology cases; the benign-humour case was not marked as a fault.                                                                                                                                                                                                                                                                             |
| P4.7 | **Code-tested.** The injected instruction was reported as a finding, not obeyed: nothing was approved, no ask was marked answered because the upload said so, and no other client was named.                                                                                                                                                                                                                                    |
| P4.8 | **Implemented** (unchanged this round, plus one fix): coverage and limitations are recorded per run, and findings are bound to the exact version and go stale on edit. New: a source-quoted finding is kept with no draft position instead of being discarded.                                                                                                                                                                  |
| P4.9 | **Awaiting Tai.** Six examples are prepared in `docs/comms-review-examples-for-tai.md` with rating lines. Not self-certified, and not counted as met.                                                                                                                                                                                                                                                                           |

### Tests

`src/domain/comms-review-eval.test.ts` — 9 checks on the set and the scoring,
including that the new laws cannot be deleted quietly. With the review server
tests: 31 passing. Types, lint and build clean.

### Raw results

Model outputs are kept out of the repository, in the sandbox only. The six
prepared examples are the deliberate exception, and contain no real material.

### Unresolved and next dependencies

- P4.4 and P4.9 need Tai. Nothing here substitutes for that.
- Everything in this round ran outside the workspace. The persisted-run
  evidence for P2.2/P2.3 and the live save/reload evidence for P3 are still
  blocked on a signed-in preview carrying these changes.
- The opportunities column is proposed only. Nothing was applied.

## Round 5 — The five destinations as one piece of work

Environment: Lovable sandbox, 2026-09-15. No signed-in session to the
workspace here, so every row below is code evidence unless it says otherwise.
Nothing was published, nothing was sent, no schema was applied, and the
historical QA session and failed run were not touched.

### What the audit found and changed

1. **The review list lied about its size.** It read the fifty most recent
   reviews and every caller treated that page as the whole workspace: the
   dashboard's "reviews not yet approved" count, the Drafts filters, and the
   "showing X of N" lines. `listReviews` now returns the page, the exact
   total, and whether it is capped. A page with no count from the database is
   marked capped rather than reported as complete. The dashboard says when its
   count comes from the recent fifty only, and Drafts names the real total.
2. **Connections had no way back from a failed read.** The route showed a bare
   error; an empty panel there reads as "nothing is connected", which is a
   different and worse claim. It now says the state could not be read, says it
   is not the same as nothing being connected, and offers Try again.
3. **Nothing said when a page was last read.** The dashboard and Connections
   now carry a plain line — read at a time, with Check again — and state that
   work done elsewhere appears on return to the tab or on that press. Nothing
   in Comms is subscribed to the database, and the pages no longer imply it.

### Acceptance

| ID   | Evidence                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P5.1 | **Code-tested.** Replies owed, past-due work and meetings needing a record come from the real relationship rows; the clock steps every minute so a page left open cannot call a passed date "due soon". Each row opens its own record, draft rows carry the draft id, review rows the session id. Silence is excluded and said to be excluded. **Blocked, live:** no persisted walk-through. |
| P5.2 | **Implemented** (Round 1, unchanged): one room per person, history, goal, reply and review stay on the same record; close and reopen change the room's state and leave follow-ups and obligations standing. **Blocked, live.**                                                                                                                                                               |
| P5.3 | **Code-tested.** A draft with a live review appears once, as that review; a closed review reads Closed and does not hide its draft; approved means a current approval, not a status word. 6 checks. **Blocked, live.**                                                                                                                                                                       |
| P5.4 | **Code-tested** (Round 4 work, re-run here): 5 concurrency checks — a save writes over only the version it started from, a stale save is refused and hands back the newer row, and a blank save never silently becomes the starting document. **Blocked, live:** concurrency in a real workspace is untested.                                                                                |
| P5.5 | **Implemented.** Captured rules and completed evaluation are shown as separate facts, grouped by profile, version and checksum, the history is labelled as bounded, and the retained rules text can be read. **Blocked, live.**                                                                                                                                                              |
| P5.6 | **Code-tested.** Mailbox state, model configuration and per-draft sendability are three separate cards; configured is never presented as working; a success older than the recent fifty runs still counts as historical success (3 checks). Failed reads on any of the three are "not known", never zero.                                                                                    |
| P5.7 | **Code-tested.** Every read on the dashboard, Drafts and Connections replaces a failed read with an unavailable state and a retry, counts are withheld on error and loading, and the capped page now names the real total (4 new checks).                                                                                                                                                    |
| P5.8 | **Implemented.** Focus and refresh re-read (the query defaults refetch on focus), mutations invalidate the surfaces they change, and both the dashboard and Connections show the time of the last read with a Check again control. No subscription is claimed. **Blocked, live.**                                                                                                            |

### Tests and gates

Whole suite: 262 files, 2942 tests passing. Types, lint and build clean. New
this round: 3 checks on the review total and cap, 1 on the partial-list
disclosure.

### T01–T05 standing

| Outcome              | State                                                                                               |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| T01 Dashboard        | Implemented, code-tested. Blocked on a signed-in walk-through.                                      |
| T02 Conversations    | Implemented, code-tested. Blocked on live.                                                          |
| T03 Drafts & Reviews | Implemented, code-tested. Blocked on live save/reload for the three draft types.                    |
| T04 Voice DNA        | Implemented, code-tested. Blocked on live, and on Tai's voice acceptance (P4.4, P4.9).              |
| T05 Connections      | Implemented, code-tested. Blocked on live, and on a completed review ever running in the workspace. |

No destination is an empty shell, and none is claimed complete: every one of
the five is code-complete and live-unverified, which is a different thing.

### Remaining blockers, unchanged

- One signed-in preview on a build carrying the Round 2 request-format fix
  would close P2.1 to P2.3, the P3 save-and-reload rows, and the live rows
  above. Everything else is waiting behind it.
- Tai's rating of the six prepared examples (P4.9) and the voice judgment
  (P4.4).
- The opportunities column from Round 4 is proposed and unapplied.

## Round 6 — The decision chain, proved without sending anything

Environment: Lovable sandbox, 2026-09-15. Every send path was exercised
against a fake provider and a database double. No message was sent, no
production publish, no schema applied, no real mailbox touched.

### Inventory of paths that can put a message out

| Path                               | Authority used                                                        | State                                 |
| ---------------------------------- | --------------------------------------------------------------------- | ------------------------------------- |
| Queue send (email)                 | `requireSendApproval` → `claimDelivery` → provider → `settleDelivery` | Covered by the boundary tests below   |
| Scout outreach "Approve & send"    | Calls `/api/public/comms/send`, the same route as the queue           | Same authority, no second path        |
| Quick reply                        | Enters the same review gate (Round 3); cannot dispatch on its own     | No separate authority                 |
| Gmail send                         | `requireSendApproval` → `claimDelivery`, bytes hashed for real        | Same authority                        |
| LinkedIn                           | `requireSendApproval`, then a person's own report — no provider       | Recorded as a human report            |
| Retired `comms-send` edge function | None — refuses everything with 410                                    | Repo body is refusal-only             |
| Scheduled sends                    | None exist. The only scheduled job is Gmail sync, which reads.        | Not applicable, verified by inventory |

### What changed

1. **A refusal pointed at the wrong file.** The "sending is held" message named
   the superseded proposal rather than the applied delivery migration. It now
   names `docs/migrations/20260914170000_comms_review_delivery_hardened.sql`.
2. **LinkedIn wording.** Confirming now says plainly that it records your own
   word, that Comms has no confirmation from LinkedIn, and that the record
   will say it rests on you. Copying is stated not to be sending.

### Acceptance

| ID   | Evidence                                                                                                                                                                                                                                                                                                                                                                                  |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P6.1 | **Code-tested.** Refused, with the provider never called, for: view-only member, invited, pending, suspended, no membership at all, and a token naming nobody. Only an active owner or admin passes.                                                                                                                                                                                      |
| P6.2 | **Code-tested.** The author is stamped on the immutable version when it was written; an admin opening a teammate's draft is the reviewer, and the packet tells the model in words that it is not the author. The sending identity is resolved separately from both.                                                                                                                       |
| P6.3 | **Code-tested.** The approved fingerprint covers channel, subject, body, to, cc, bcc, sending identity and every attachment's name, type, size and digest, built in one place that approval and every dispatch path share.                                                                                                                                                                |
| P6.4 | **Code-tested.** A change to any of those, to the situation, the revision or the version refuses the send. A replacement file of exactly the same size is caught, because identity is the storage path digest (or the real content digest where the bytes are in hand), never name and length. Unsaved edits show pending review (Round 3).                                               |
| P6.5 | **Code-tested.** Failed, incomplete, closed and stale reviews, a standing must-fix, an approval belonging to another review, a run that read another version, and two open reviews claiming one draft all refuse. The draft's own status field authorises nothing.                                                                                                                        |
| P6.6 | **Code-tested.** Two sends racing on the same approved message produce one provider call: the second loses on the unique key and is told it is already in progress. A lost answer is Unknown, is never retried automatically, and does not reset the draft.                                                                                                                               |
| P6.7 | **Code-tested.** An attempt that cannot be written down is not attempted. A unique-key collision whose existing row is a different draft refuses instead of replaying. A receipt that cannot be stored stays unknown and asks for a person. A settled attempt cannot be rewritten: settlement only matches an attempt still in flight, and a no-match says the attempt needs reconciling. |
| P6.8 | **Implemented / Blocked, live.** Every active route goes through the one authority (table above). The repository body of the retired function refuses with 410 and sends nothing. The deployed 410 has not been invoked from here — no authorized authenticated invocation is available in this sandbox, so that check stays blocked rather than assumed from the file.                   |
| P6.9 | **Code-tested.** A LinkedIn record is described as your word, never as provider confirmation, in both the interface and the shared wording.                                                                                                                                                                                                                                               |

New this round: 7 checks (suspended, pending, tokenless caller, unwritable
attempt, key collision on another draft, concurrent claim, unrewritable
receipt). Whole suite: 262 files, 2949 tests passing. Types and build clean.

### Remaining blockers

- P6.8's live invocation of the deployed 410.
- Real delivery remains unverified and stays that way until Tai authorises a
  controlled test with a named recipient and an exact message. A fake provider
  proves the control flow, not that mail arrives.
- Everything still waiting on the signed-in preview (P2.1–P2.3, the P3
  save-and-reload rows, the live rows in Round 5) and on Tai (P4.4, P4.9).

## Round 7 — Usability, keyboard and recovery

Environment: Lovable sandbox, 2026-09-15, Chromium via Playwright against
localhost. Production Comms routes fail closed without a session here, so the
interactive walks used the approved fixture workspace at
`/mockups/comms-workspace-v2`, which is the same geometry and component
language. That is stated on every row it affects rather than presented as the
real workspace. Nothing published, nothing sent, no schema applied.

### What the walks found, and what changed

1. **Six unnamed buttons at the top of the keyboard path.** The collapsed
   navigation rail showed only icons, so the first six stops announced
   nothing at all. They now carry their names (Pulse, Scout, Comms, Roadmap,
   Projects, People) when collapsed. Verified by re-walking: the names are
   there. The production rail was checked too and always used text labels.
2. **A review gave no spoken account of itself.** Saving, running, failing
   and finishing were visible only as button states. A polite status line now
   says which of those is happening, and on completion how many findings and
   how many must be fixed. It names the stage that is actually happening and
   never a percentage, because nothing can honestly say how far through a
   review is.
3. **Findings were a stack of boxes.** They are now a real list with a count
   in its label, so a screen reader says "3 items" and which one this is, and
   a decision on one is announced when it lands.
4. **The intake error was silent.** A failed intake now announces itself
   instead of only appearing.

### Measured

| Check                                              | Result                                                                                                          |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Horizontal overflow at 1440×900, 768×1024, 375×812 | 0 px at all three                                                                                               |
| Console errors during load at all three sizes      | none                                                                                                            |
| Focus visibility                                   | every stop carried a visible ring: 2 px outline on buttons, a 2 px focus ring on text fields                    |
| Keyboard trap                                      | none across 25 stops; the walk moved through rail, search, list, thread, goal, reply and actions and kept going |
| Mobile primary action                              | "Review draft" visible without scrolling past the reply box                                                     |

Screenshots: `/tmp/browser/r7/desktop.png`, `tablet.png`, `mobile.png`
(fixture workspace, sandbox only).

### Acceptance

| ID   | Evidence                                                                                                                                                                                                                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| P7.1 | **Live-verified on the fixture workspace.** No horizontal overflow at any of the three sizes; the mobile view is a focused conversation, not the desktop stack; the primary action is reachable. **Blocked** for the real workspace, which needs a session.                                                                                                  |
| P7.2 | **Live-verified on the fixture workspace.** 25 keyboard stops, every one named and visibly focused, no trap. Production dialogs return focus to the control that opened them (the relationship drawer moves focus to its own Close). **Blocked** for the real workspace.                                                                                     |
| P7.3 | **Implemented / Code-tested.** Every input is inside its own label; icon-only controls carry names; must-fix is a separate heading and a word, never a colour alone; errors say what to do next. Colours come from the OS tokens, which pair foreground on background at AA. **Blocked:** no automated contrast audit was run against the signed-in screens. |
| P7.4 | **Implemented.** Saving, running, failing and finishing are four distinct announced states, tied to real stages. No fabricated progress.                                                                                                                                                                                                                     |
| P7.5 | **Code-tested / Implemented.** Unsaved writing is protected on tab, person, record, back and reload (Round 1), a failed save keeps the text, and stale readiness re-asks (earlier rounds). Signing out cancels every query and clears the cache, and no Comms draft is written to browser storage anywhere — so nothing survives into the next session.      |
| P7.6 | **Code-tested.** A pending button is disabled and marked busy, so a double click cannot start a second review; a review is refused outright while the draft is dirty. Lists are capped with real totals (Round 5). **Blocked:** no measured duration, because no review has completed in a real workspace yet; an invented number would be worse than none.  |
| P7.7 | **Implemented.** Controls either act or say the exact condition: a review cannot run on unsaved words and says so; approval names what is missing; Connections names the missing setup. Empty states say what is absent and what to do.                                                                                                                      |

### Tests and gates

Whole suite: 262 files, 2949 tests passing. Types and build clean. No test
was changed to accommodate a fix.

### Residual, minor

- The interactive evidence is from the fixture workspace, not the signed-in
  one. Owner: whoever runs the signed-in preview.
- No automated contrast audit on the signed-in screens. Owner: same.
- No measured review duration until a review completes live. Owner: same.
