# Comms review upgrade: progress and outcome gates

Source brief: `docs/comms-review-brief.md`. Updated 14 September 2026.

Stage: **1 of 4 — interactive mockup inside the authenticated app.**
Route: `/mockups/comms-next`. Production `/modules/comms` is unchanged.

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
