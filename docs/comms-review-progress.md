# Comms review upgrade: progress and outcome gates

Source brief: `docs/comms-review-brief.md`. Updated 14 September 2026.

Stage: **2 of 4 — functional build has begun. Slice 1 shipped.**
Prototype route `/mockups/comms-next` remains for reference. Production
`/modules/comms` keeps its current surfaces; slice 1 changed drafting truth,
not the interface.

Honesty rules for this file: a gate is only Met when there is evidence a person
can open. Anything scripted in the prototype is named as simulated, never as
working behaviour.

## Stage gates

| Gate | State | Evidence |
| --- | --- | --- |
| Brief saved in the repository | Met | `docs/comms-review-brief.md` |
| Progress tracking exists | Met | this file |
| Interactive mockup inside authenticated app | Met | `src/routes/mockups.comms-next.tsx`, rendered in `AppShell` |
| Sample data isolated and labelled | Met | `src/data/mockups/comms-next.ts`, prototype banner and "What is simulated here" footer |
| Discoverable preview entry | Met | "Preview" tab in `src/components/tt/comms/comms-tabs.tsx` |
| Production Comms behaviour preserved | Met | only addition to production is the one navigation link; no service, store, route or send path changed |
| No publish, no external send | Met | prototype has no service call; Approve control is disabled |
| No Lovable Cloud provisioning | Met | no backend enabled; later persistence targets the existing external Supabase project |
| Functional implementation on real records | Pending | stage 2, after review of this prototype |
| Persistence design (review runs, versions, findings, coverage) | Pending | schema to be authored after inspection; no migration in this stage |
| Approval binding across every send entry point | Pending | stage 3 |
| Follow-up learning and lesson promotion | Pending | stage 4 |

## Mockup acceptance scenarios

| # | Scenario | State | Where to see it |
| --- | --- | --- | --- |
| 1 | Conversations, one priority, readable thread, editable My read | Met | Conversations, Northlight Care thread |
| 2 | Manual review from pasted communication and one attachment | Partly met | Review, "New review" intake. Form is interactive; attachment upload is simulated |
| 3 | Four questions asked, three answered, missing one linked to source | Met | Review, question coverage panel |
| 4 | "Everything will be ready Friday" flagged for ambiguity and unsupported promise, no invented date | Met | Review, Must fix, finding 1 |
| 5 | Proposal total conflicts with line items; proposed work described as existing | Met | Review, Must fix, findings 3 and 4 |
| 6 | Question past character 900, thread longer than 40 messages | Met | Northlight thread header and late-question note; coverage row 4 |
| 7 | Unreadable attachment gives partial review plus visible incomplete coverage | Met | Review, source material panel, plus the coverage-incomplete summary |
| 8 | Accept one edit, keep another with a reason, correct the goal, rerun | Partly met | Finding controls and My read correction work locally; rerun is scripted |
| 9 | Warm exchange offers optional light line; complaint gets accountability, no pitch | Met | Harbour Studio and Ferngrove Dental threads; optional line in Suggestions |
| 10 | Salesperson keeps their identity and signature | Met | Review, Confirm, sender finding |
| 11 | Ready for approval requires complete coverage; edits make approval stale | Partly met | Stated in the approval panel; staleness is not yet simulated as a state change |
| 12 | Missing email, save failure, reviewer failure, send failure states | Pending | not yet built into the prototype |
| 13 | Old tab links resolve; threads stay distinct; duplicate arrival does not duplicate | Pending | requires the navigation consolidation in stage 2 |
| 14 | Mobile review without horizontal scrolling or lost draft | Partly met | single-surface list and detail with Back at 375px; full review panel stacks |

## What is simulated in this stage

- Every thread, person, draft, finding, coverage row and follow-up is invented sample data.
- Review runs are scripted. No model is called and no intelligence run is recorded.
- Approve, send, save, snooze and dismiss change local screen state only.
- File ingestion states are illustrative. Nothing is uploaded or extracted.
- No production Comms record is read, written, or sent from the prototype route.

## Next decision for Tai

Review `/mockups/comms-next`, then confirm whether stage 2 proceeds with the
navigation consolidation first, as the brief sequences it.


## C01 to C22 gate assessment

States mean exactly one thing each. **Implemented**: real code on real records.
**Verified**: implemented and proven by a test or an inspectable run.
**Mockup only**: exists in `/mockups/comms-next` as scripted prototype
behaviour, nowhere else. **Unmet**: not built.

| Gate | State | Note |
| --- | --- | --- |
| C01 Three surfaces, one Comms | Mockup only | Production still ships eight tabs |
| C02 Manual review intake | Unmet | No intake path on real records |
| C03 One readable conversation view | Mockup only | Prototype only |
| C04 Full context, newest included | Verified | Slice 1: newest-first window, long messages kept whole, read window stated |
| C05 Explicit question coverage | Implemented | Slice 1: asks extracted with position, coverage computed per draft; not yet shown in the interface |
| C06 Evidence-backed findings | Partly implemented | Judgment pass exists; findings are not persisted or itemised |
| C07 Conflict and unsupported-claim detection | Unmet | |
| C08 Actual sender identity | Verified | Slice 1: the draft closes with the author's own name; Tai's name is no longer attached to other people's words |
| C09 Attachments as context only | Unmet in Comms | |
| C10 Shared approval across entry points | Unmet | `comms-quick-reply` still bypasses review |
| C11 Version-bound, idempotent delivery | Unmet | |
| C12 Honest incompleteness | Partly implemented | Slice 1 records the read window truthfully; review-level coverage reporting still to come |
| C13 Warm and complaint registers | Partly implemented | Register guides and ask gate exist |
| C14 Voice rules enforced deterministically | Partly implemented | Voice pass runs; signature is now per sender |
| C15 Human correction respected | Partly implemented | Corrections outrank inference in retrieval; no review-level correction store |
| C16 Follow-ups persist | Partly implemented | |
| C17 Lessons learned from decisions | Partly implemented | |
| C18 Accessibility | Partly implemented | |
| C19 Failure states are honest and specific | Unmet | Typed draft failures exist; review and send failures do not |
| C20 No autonomous send | Implemented | Approval is required before any send |
| C21 Follow-ups surface | Mockup only | |
| C22 Evaluation evidence per run | Partly implemented | Slice 1 records provider, model, prompt version and source window on the draft result; runs are not yet stored |

## Slice 1: truthful context and the real sender

Shipped. No new tables, no interface redesign.

- `src/lib/comms-draft.server.ts` reads the conversation newest first with an
  exact message count, so the request that arrived today is always inside the
  window, and the window's limits travel with the draft.
- `src/domain/comms-judgment.ts` keeps a message whole instead of cutting it at
  900 characters, and `threadWindowForJudgment` states coverage rather than
  implying it.
- `src/domain/comms-coverage.ts` extracts every question and actionable request
  with its character position, and reports how the draft answers each one. It
  is rule-based and labelled as such.
- `src/domain/comms-sender.ts` and `src/data/voice-policy.ts` sign a message
  with its actual author. An unknown author leaves the draft unsigned.
- Tests: `comms-coverage.test.ts`, `comms-sender.test.ts`, thread window and
  sender cases in `comms-judgment.test.ts` and `comms-draft.server.test.ts`.

## Next slice and its backend dependency

Slice 2 is review runs on real records: an immutable draft version per run,
findings with evidence, stored coverage, and approval that checks a role rather
than organisation membership. It cannot ship without SQL applied by Tai to the
existing external Supabase project: tables for review runs, draft versions,
findings and coverage, plus a role-checked approval path. Draft RLS currently
lets any organisation member edit a draft, so approval authority has to be
enforced separately from edit rights.
