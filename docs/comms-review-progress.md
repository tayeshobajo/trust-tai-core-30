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

## Next backend step

Apply `docs/migrations/20260914150000_comms_review_runs.sql` to the existing
external Supabase project `okydosoacqdnursmmenf`. It is idempotent and
additive. Until it is applied, `/modules/comms/review` will report an honest
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
