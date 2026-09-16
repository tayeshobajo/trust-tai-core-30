# Comms: outcome acceptance contract (C01–C22)

Source: Tai's acceptance and delivery contract for the Comms upgrade.
Restated here on 14 September 2026 so every criterion has one fixed home in
the repository and no criterion drifts again.

**Restored 14 September 2026 (slice 3).** These IDs are Tai's original
supplied contract. An earlier edit of this file had renamed several criteria
(C03, C07, C09, C10, C11, C14-C21) rather than recording their honest status;
the original meanings are restored above and the statuses in the progress file
are restated against them. No criterion was retired to make a status look
better.

**Honesty note on this file.** The wording below is a faithful restatement of
the criteria as given, not a verbatim paste of Tai's document. Where the
earlier progress file had drifted (notably C02, which had been recorded as
"manual review intake" instead of identity and old routes), the definition
here is the corrected one. If any wording differs from Tai's canonical
document, Tai's wins and this file is corrected, not the other way round.

## What the states mean

Exactly one state per criterion, and each means one thing only.

| State | Meaning |
| --- | --- |
| **Verified** | Real code on real records, proved by a test or an inspectable run. |
| **Implemented** | Real code on real records; not yet proved by a test or run. |
| **Partly implemented** | Some of the behaviour exists on real records; the criterion as written does not. |
| **Mockup only** | Exists as scripted prototype behaviour in `/mockups/comms-next`, nowhere else. |
| **Unmet** | Not built. |

Two further distinctions are never collapsed:

- **Code evidence** (unit tests, typecheck, build) is not **live evaluation**
  (a signed-in person, real records, a real model run). Claims of the second
  require a run someone can open.
- Rendering a prototype inside `AppShell` does **not** establish that it is
  authenticated. Authentication is `WorkspaceGate` plus a verified active
  membership, server-side.

## The criteria

| ID | Criterion |
| --- | --- |
| C01 | Comms is three surfaces - Conversations, Review, Follow-ups - not a tab rack. |
| C02 | Identities are preserved and old routes still resolve: no person is merged or lost, every previously valid Comms link lands somewhere correct, threads stay distinct, and a duplicate arrival does not duplicate a conversation. |
| C03 | My read and the goal are editable by the person, and what they write governs the work. |
| C04 | Full context, newest included. A bounded read window is stated as bounded; it is never presented as the whole conversation. |
| C05 | Source coverage is honest: what was read, what could not be read, and what type it was. |
| C06 | Judgment is evidence-backed: every finding quotes the exact words it is about, in the exact version it is about. |
| C07 | Edits and re-runs are bound to an exact version: a changed message is a new version and old evidence does not carry over. |
| C08 | Actual sender identity: a message is signed by the person who wrote it. |
| C09 | Private opportunities stay private: an internal observation is never addressed to the counterpart. |
| C10 | Humour and warmth are handled distinctly: warmth may offer an optional light line; a complaint gets accountability and no pitch. |
| C11 | Proposal consistency: totals that disagree, proposed work described as existing, and promises the evidence does not support are caught. |
| C12 | Explicit findings and question coverage: every question and actionable request the counterpart made is tracked, with where it was found and whether the reply answers it. |
| C13 | Attachments are context only. They are read or honestly named as unread; they never become outbound attachments and are never assumed understood. |
| C14 | Approval is a real, recorded human decision bound to what was actually reviewed. |
| C15 | Shared approval and send enforcement: every send entry point asks the same authority; no path to a send skips review. |
| C16 | Delivery is truthful: version-bound, idempotent, and honest about an outcome that cannot be confirmed. |
| C17 | Isolation: one client's names, dates, facts and material never enter another client's message. |
| C18 | Follow-ups persist across sessions and are not re-derived each time. |
| C19 | Lessons are learned from human decisions and change later behaviour. |
| C20 | Failure states are honest and specific: missing email, save failure, reviewer failure, send failure each say what happened and what was not changed. |
| C21 | Accessibility: keyboard reachable, legible at 375px, no lost draft. |
| C22 | Evaluation evidence per run: provider, model, prompt version, source window and coverage are recorded with the run. |

## Standing laws over all of it

1. Nothing sends itself. Approval is a human act, recorded with a name and a
   time, bound to one exact version.
2. Approval authority is a role, not membership. Being able to edit a draft
   has never been the same thing as being able to approve one.
3. Unknown is not zero. A question that could not be judged stays open; it is
   never rounded up to answered.
4. A bounded read is stated as bounded.
5. Simulated prototype behaviour is never described as working behaviour.

## Extension: the strategic judgment gate (S01-S07)

Added 16 September 2026. Nothing above is changed, renamed or retired. The
reviewer gained two further capabilities, recorded as separate versioned
criteria in `docs/comms-strategic-judgment.md`: relationship continuity
(S01-S03) and commercial opportunity sensitivity (S04-S05), with their
separation from private future opportunities (S06) and the unchanged approval
gate (S07). C01-C22 keep their original meanings and their original statuses.
