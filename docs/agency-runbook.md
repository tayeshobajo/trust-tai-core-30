# Trust Tai OS: how the day works, by role

This is the short operating runbook for the eight people. It describes what
exists in the build today. Where something is not connected yet, it says so in
place rather than describing an intention as if it worked.

Pinned build: see the "Evidence and build" line of Round R5 in
`docs/agency-operational-readiness.md`.

## Everyone: start the day

1. Open Home. The three cards are My next actions, AI prepared work and
   Decisions needed. Each row names one thing and one action.
2. If a card shows a banner saying a source could not be read, the list under
   it is incomplete. Say so before you plan the day; do not treat it as empty.
3. Switch Mine and Everyone only if you lead. Everyone is a view, not a
   permission: it shows what you may already read.
4. Prepared work reads as not set up until the preparation tables exist. That
   is correct, not a fault.

## Everyone: find the work

- Home rows link into the room that owns the record. Work is changed there,
  never on Home.
- A client page opens with "Where this stands" and "The path so far": stage,
  agreed outcome, next action, owner, blocker, scope version, then the seven
  stages in order with who accepts each one.
- A word like "Inferred, not approved" or "Could not be read" is the answer,
  not a placeholder. Treat it literally.

## Account lead: review and accept

1. Open the stage that needs a person. The strip names who decides.
2. Scope, price and commitments are accepted by you. Nothing in the system
   accepts them for you, and nothing sends anything outward.
3. A proposal derives from one frozen roadmap version. Changing the roadmap
   creates a new version and invalidates review readiness. Re-read before
   accepting.
4. Comms drafts, reviews and approvals keep their existing gates. This round
   changed none of them.

## Delivery lead: resolve blockers

1. A blocked stage states why, in the words of the room that owns it.
2. Work with no named owner reads "Needs an owner". Assign in the owning room.
3. A quiet client is not a risk on its own. Something is stalled only when a
   reply is owed or a next action has gone stale.
4. Over-allocation and delivery load are visible on Pulse. No screen offers a
   date, so no date is offered without a person.

## Everyone: end the day

1. Return to Home. Anything still in Decisions needed is tomorrow's first item
   and already names its owner.
2. Leave nothing owed on Comms without a named next action.

## Weekly: the health review

Open Pulse, section "Is the business healthy". Seven readings, each with its
source, period, denominator, when it was read and where to drill in:

| Reading | Today |
| --- | --- |
| Qualified pipeline | Measured from proposals sent and still open |
| Oldest undecided proposal | Measured in days |
| Proposals awaiting decision | Measured count |
| Delivery in flight | Measured, open projects against all projects |
| Overdue receivables | Not connected. No invoicing or payment source exists |
| Margin where cost exists | Unavailable. No cost source. Unknown cost is not zero cost |
| Care and renewal due | Measured from recorded review and renewal dates |

No metric carries a target. Targets are set by an owner or admin in Settings,
Outcomes; the system does not invent one. An unavailable reading is never
drawn as a zero.

## The three preparation jobs

| Job | Owner | Trigger | Enabled | Limits | Stop | Recovery |
| --- | --- | --- | --- | --- | --- | --- |
| Enquiry qualification | Scout | Enquiry received | Disabled | Bounded attempts, lease per claim, quota reserved before spend | Policy switch refuses new claims | Expired lease is reclaimed; an unknown provider outcome is not retried automatically |
| Conversation brief | Comms | Conversation updated | Disabled | Same | Same | Same |
| Milestone status draft | Projects | Milestone accepted | Disabled | Same | Same | Same |

All three are disabled by default and none is triggered automatically by a
room today: the authenticated entry point exists at
`/api/public/preparation/run`, but no room handler calls it, and the three
tables it writes do not exist yet. Turning them on is an explicit decision by
an authorized person after the schema is applied.

## What this build will not do

It does not publish, send an outbound message, take a payment, widen mailbox
scope, activate a production schedule, apply schema, or accept scope or price
on anyone's behalf.
