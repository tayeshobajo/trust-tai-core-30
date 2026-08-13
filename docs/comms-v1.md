# Comms v1 — the relationship room

Comms is not an inbox. It is Trust Tai's relationship and networking operating
system: no meaningful message falls through, and every outreach sounds like Tai.

**Operating principle: small input, deep intelligence, clear output.**

## The three panes

1. **Queue (left).** Every live relationship, grouped by what is true rather
   than by folder: Needs you, New from Scout, Met in person, Waiting on them,
   Warm, Gone quiet. Bucketing and coverage are pure functions in
   `src/data/comms-queue.ts`.
2. **Workspace (centre).** One person in full: identity, stage, next move, what
   we know in three separated tiers (observed, inferred, decided), and the
   history of what actually happened.
3. **Next move rail (right).** A truthful reason to reach out, and a draft
   written under the organization's Voice DNA.

## Timing

`dueState` in `src/domain/comms.ts` is the one timing read the queue and the
workspace share. A reply we owe outranks a follow-up we planned. A relationship
with nothing due and no contact for 45 days has gone quiet; it is not late.

`last_touch_at` only moves when a person logs something that happened, so the
queue can never claim contact that did not occur.

## Reasons to reconnect

`src/data/comms-reminders.ts` produces a reason only when something true
supports it: a commitment we made, an inbound we have not answered, a company
signal, a role change, an unfollowed in-person meeting, a long silence after we
wrote, or an anniversary of meeting. An empty list is a valid and common answer.
Comms surfaces a reason; it never manufactures one to keep a cadence alive.

## Voice DNA

`src/domain/voice.ts` holds the rules; `src/data/voice-policy.ts` enforces them
deterministically rather than burying them in a prompt. Em dashes and the
signoff are repaired mechanically. Generic check-ins, exclamation marks, needy
phrasing, and promises are flagged or blocked. A blocking violation prevents
approval. Anything in the sensitive register is always held for human review.

The document itself lives per organization in `comms_voice_profiles` and is
editable by owners and admins at `/modules/comms/voice`.

## Drafting boundary

`src/lib/comms-draft.server.ts` composes one short message from the Voice DNA,
the chosen register, and the relationship's recorded evidence. Only observed
facts and human decisions may be cited; inferences may guide the angle but never
become a claim. With no AI provider configured, Comms returns a plain
deterministic draft rather than inventing one.

**Comms does not send.** A draft is composed, checked, approved, and marked as
sent by a person.

## Scout handoff

`src/data/supabase/comms-handoff-receiver.ts` turns a Scout brief into a
relationship at stage `ready_to_reach`, carrying the primary contact, the intent
as the next move, and every required context item into its matching tier. It is
idempotent per prospect. If Comms is not provisioned, the Scout handoff still
stands.

## Capture

Adding someone you met takes a name. Where you met and one thing worth
remembering are optional, and the note is stored as a human decision with human
evidence. Nothing is enriched silently.

## Persistence

Six organization-scoped tables (`comms_relationships`, `comms_threads`,
`comms_touches`, `comms_drafts`, `comms_reminders`, `comms_voice_profiles`),
defined in `docs/comms-v1-schema.sql`. Until they are applied, Comms shows a
calm "not provisioned" state instead of failing.

## Deliberately deferred

- No mailbox, calendar, or LinkedIn sync. Every touch is logged by a person.
- No sending of any kind.
- No event feeds or contact enrichment providers.
- No sequences. Relationships are not campaigns.
