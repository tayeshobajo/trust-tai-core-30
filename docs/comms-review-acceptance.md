# Comms: outcome acceptance contract (C01–C22)

Source: Tai's acceptance and delivery contract for the Comms upgrade.
Restated here on 14 September 2026 so every criterion has one fixed home in
the repository and no criterion drifts again.

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
| C01 | Comms is three surfaces — Conversations, Review, Follow-ups — not a tab rack. |
| C02 | Identities are preserved and old routes still resolve: no person is merged or lost, every previously valid Comms link lands somewhere correct, threads stay distinct, and a duplicate arrival does not duplicate a conversation. |
| C03 | One readable conversation view: the whole exchange, newest included, legible without reconstruction. |
| C04 | Full context, newest included. A bounded read window is stated as bounded; it is never presented as the whole conversation. |
| C05 | Explicit question coverage: every question and actionable request the counterpart made is tracked, with where it was found and whether the reply answers it. |
| C06 | Findings are evidence-backed: each one quotes the exact words it is about, in the exact version it is about. |
| C07 | Conflicts and unsupported claims are detected: totals that disagree, proposed work described as existing, promises the evidence does not support. |
| C08 | Actual sender identity: a message is signed by the person who wrote it. |
| C09 | Attachments are context only. They are read or honestly named as unread; they never become outbound attachments and are never assumed understood. |
| C10 | Shared approval across every send entry point. No path to a send skips review. |
| C11 | Delivery is version-bound and idempotent: what was approved is what goes, once. |
| C12 | Honest incompleteness: what could not be read is named, and coverage is never implied. |
| C13 | Warm and complaint registers are handled distinctly: warmth may offer an optional light line; a complaint gets accountability and no pitch. |
| C14 | Voice rules are enforced deterministically in code, not left to the model. |
| C15 | Human correction is respected and outranks inference, durably. |
| C16 | Follow-ups persist across sessions and are not re-derived each time. |
| C17 | Lessons are learned from human decisions and change later behaviour. |
| C18 | Accessibility: keyboard reachable, legible at 375px, no lost draft. |
| C19 | Failure states are honest and specific: missing email, save failure, reviewer failure, send failure each say what happened and what was not changed. |
| C20 | No autonomous send. A person approves before anything leaves. |
| C21 | Follow-ups surface where the work is, not only in a list. |
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
