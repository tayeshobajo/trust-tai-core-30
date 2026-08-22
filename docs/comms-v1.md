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
idempotent per prospect: a second handoff of the same prospect returns the
relationship already open rather than a duplicate, enforced both by the receiver
and by a unique index on `(organization_id, prospect_id)`.

## Capture

Adding someone you met takes a name. Where you met and one thing worth
remembering are optional, and the note is stored as a human decision with human
evidence. The person is matched against the shared `contacts` table first, by
email and then by exact name, so a capture never creates a second copy of a
human being. Nothing is enriched silently.

## Persistence

Six organization-scoped tables (`comms_relationships`, `comms_threads`,
`comms_touches`, `comms_drafts`, `comms_reminders`, `comms_voice_profiles`),
defined in `docs/comms-v1-schema.sql` and live in the Trust Tai Supabase project
with RLS enabled. Every policy checks membership through the hardened
`private.is_org_member(organization_id)` helper, so every read and write passes
as the signed-in member. A failed read is reported as the real error it is.

## Deliberately deferred

- No mailbox, calendar, or LinkedIn sync. Every touch is logged by a person.
- No sending of any kind.
- No event feeds or contact enrichment providers.
- No sequences. Relationships are not campaigns.

## External integrations (Phase 0 in place)

The integration layer is contracted before it is connected. `src/domain/comms-integrations.ts`
holds the `MailProvider` and `EventProvider` shapes, connection state, and the
derived `ThreadRead`; `src/data/comms-thread-state.ts` turns a message stream
into that reading as a pure function, proved from fixtures with no vendor
present. `src/data/events/registry.ts` mirrors the people registry and is
deliberately empty until an approved source exists.

`docs/comms-integrations-schema.sql` is the exact statement set for
`comms_messages`, `comms_integrations`, `comms_events`, `comms_event_targets`
and the new thread columns. It has not been applied; until it is,
`/modules/comms/integrations` reports every track as not connected. Refresh
tokens live in `private.comms_integration_secrets`, readable only by the
service role, and Gmail is requested read-only so sending stays impossible by
construction.

## Gmail track (Phase 1, read-only)

Credentials live on the server only: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, plus `COMMS_TOKEN_ENC_KEY` and
`COMMS_OAUTH_STATE_SECRET`. The browser never sees any of them.

Registered redirect URI (exact match required by Google):

- preview: `https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/comms/gmail/connect`
- production: `https://project--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/api/public/comms/gmail/connect`

Flow:

1. A member clicks Connect. The server signs a state (organization + return
   path + issue time) and returns Google's consent URL. Scope requested:
   `gmail.readonly` only, so Comms cannot send.
2. Google calls back to `/api/public/comms/gmail/connect`. That callback has no
   Trust Tai session, so it touches no data: it verifies the signed state and
   bounces the browser back to `/modules/comms/integrations` with the code.
3. The signed-in page posts the code back. The server exchanges it, reads the
   mailbox address, writes `comms_integrations`, and stores the refresh token
   sealed with AES-GCM through `comms_put_integration_secret`. Even a member
   reading that value back gets ciphertext.
4. Read now runs one bounded, label-gated pass. The ingestion boundary is
   the Gmail label `Trust Tai/Comms`: its id is resolved from Gmail's own
   `/labels` list (matching the full nested path, never a free-text `label:`
   search, which would split on the space and slash), and every message
   listing is constrained by that label id plus the overlap window. Unlabeled
   mail — promotions, newsletters, alerts, even mail with a person Comms
   knows — never enters the candidate set. Listing is capped at 60 messages
   over the window, metadata and snippet only. Identity is decided after
   listing: a message is stored only when a participant matches an existing
   `comms_relationships` email. Labeled mail with someone not yet in Comms
   is counted and left unstored, and that person is surfaced for review
   through the mailbox import ("Labeled in Gmail, not yet in Comms") — a
   human Add-to-Comms decision, never an automatic one. A missing label
   fails safe with a clear "Needs attention" status; there is no
   whole-mailbox fallback. An empty relationship list is a clean no-op — no
   Gmail work at all. Upserts key on
   `(organization_id, provider, provider_message_id)`, so repeat passes are
   idempotent. Thread state and the response clock come from the pure
   `readThread` reading, not from Gmail. Comms never adds, renames, or
   removes Gmail labels — labeling is Tai's act, in Gmail.

Body retention is off: only snippets are stored. `comms_messages.body_text`
exists for a later opt-in and is never written today.

Requires `docs/comms-integrations-schema.sql` to be applied in the Trust Tai
Supabase project, including the two SECURITY DEFINER credential functions at
the end of that file.
