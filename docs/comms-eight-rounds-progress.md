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
