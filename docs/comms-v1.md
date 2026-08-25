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

Spirit first. Reason first. Write second. `src/lib/comms-draft.server.ts` does
not generate messages: it makes a relationship-specific **communication
judgment** (`src/domain/comms-judgment.ts`) over governed evidence — identity,
stage, observed/decided memory, open commitments, and the recent thread —
then writes the message that judgment requires. The judgment is persisted
with the draft's rationale, so the reasoning a person approves is inspectable,
never hidden.

**Tai Relationship Voice vs Brand Voice.** The canonical baseline for every
message is Tai's relationship voice (`TAI_RELATIONSHIP_VOICE` in
`src/domain/voice.ts`): spirit first — see the person before the transaction,
make them feel specifically seen, create spaciousness rather than pressure —
then warm, calm, concise, human, specific prose with natural contractions,
short paragraphs, and no corporate language, manufactured urgency, fake
familiarity, invented personalization, forced CTA, or em dashes. The org
Voice DNA document is the editable **brand expression**; approved/sent
messages and Tai's edits are **learned style influence**. Both layer on top of
the canonical baseline — neither replaces it — and the evidence packet keeps
the three provenances separate (`canonicalRelationshipVoice`,
`relationshipEvidence`, `brandVoiceDna`, `learnedStyleExamples`). Website and
content rules (roadmap language, proprietary frameworks, declarative
headlines, positioning) never enter an ordinary email unless the actual
conversation calls for them; personal email may ask natural questions.

The laws this boundary enforces:

- **Grounding gate before any model call.** `assessDraftGrounding` decides
  whether a trustworthy draft is possible at all. A real thread plus a known
  identity grounds a reply. A known identity plus one real prior interaction
  plus a reason grounds a proactive note. Extra memory, commitments, Scout
  context, and approved examples improve a grounded draft but are never
  mandatory. Below the bar, drafting would require inventing the reason, the
  facts, or the relationship — so Comms fails honestly and names what is
  missing: "Comms can't draft this message without inventing a real prior
  interaction and a reason to write now. Nothing was created."
- **Comms does not generate messages.** It judges, then writes. The structured
  judgment (`whyNow`, `latestHumanSignal`, `whatThisSaysAboutThem`,
  `whatDeservesAcknowledgment`, `threadToBuildOn`, `intendedEffect`,
  `responseObligation`, `askDecision`, `factsAllowed`/`factsAvoid`,
  `voiceEvidenceUsed`, `learnedExamplesUsed`) comes first; prose is written
  FROM it. The visible rationale is a few concise lines: Why now · What I
  noticed · What it says about them · What to build on · Ask (with its
  reason), or "No ask" with the reason no ask belongs.
- **Conversation before conversion.** The judgment reads the room in order —
  Notice the human signal in the latest message (generosity, pride,
  curiosity, care, excitement, frustration), Understand what it says about
  the person, Reflect it back so they feel recognized rather than targeted,
  Build on the most interesting thread they offered — and only then Decide
  whether an ask belongs. Do not advance the relationship because advancement
  is possible; respond first to what the person just gave. Make the person
  feel interesting, not merely praised: specific recognition of something
  they revealed almost casually, never a generic compliment. The operational
  law: don't look for the fastest way to the next step; look for the most
  human thing worth responding to. A relationship can be moving even when
  there is no ask.
- **The ask gate.** An ask must be earned by the conversation. `askDecision`
  is allowed only when one of these is true, and `whyNatural` must name
  which: they explicitly suggested talking; something genuinely requires live
  discussion; active reciprocal exploration; clear reciprocal curiosity; a
  meeting makes their life easier right now; the conversation has naturally
  arrived there. "Maintain momentum", "build the relationship", and "stay
  connected" fail the gate — the default is often no ask. Enforcement is
  deterministic, not prompt-only: when `shouldAsk` is false,
  `unearnedAskInBody` scans the written draft for a snuck-in call/coffee/
  meeting ask, the writing pass is corrected once in plain language, and if
  it still cannot honor the judgment the draft fails closed
  (`ask_gate_violated`). No forced momentum: "would you be open to a call" is
  never a fallback.
- **Fail honestly.** There is no mail-merge fallback. With no provider, or no
  trustworthy parse, drafting fails closed: "Comms couldn't prepare a
  trustworthy draft from the available context. Nothing was created." A
  generic draft impersonating intelligence is worse than none.
- **Evidence is governed.** Only observed facts and human decisions may be
  cited; inferences guide the angle but never become a claim.
- **Names are human-safe.** Salutations come from `salutationName`, which
  understands comma formats ("Vinyard, Larry" → "Larry") and never produces
  "Vinyard,,".
- **Grounding is visible before send.** Every prepared draft persists a
  `summarizeDraftGrounding` summary (`draft_grounding` on the rationale) and
  the composer shows it: a calm level (Well grounded / Grounded / Thin
  grounding), the plain-language basis (thread, memory, commitments, approved
  examples, stated reason), and — when thin — what would sharpen the next
  draft. A reply on a real thread is never called thin.
- **Human approval remains mandatory** before anything sends, and the
  deterministic Voice pass gates every draft.

_Status: implemented 2026-08-23; not yet production-human-accepted — pending
Tai's live testing of real drafts._

**Drafts never trap the conversation.** Close is not discard. The draft editor
opens only by a person's choice, keyed to the relationship; closing it saves
the work and returns to the thread, where a quiet resume affordance keeps the
draft one click away. Discard is a separate, explicit, confirmed action.

**Comms does not send.** A draft is composed, checked, approved, and marked as
sent by a person.

## Scout handoff

`src/data/supabase/comms-handoff-receiver.ts` turns a Scout brief into a
relationship at stage `ready_to_reach`, carrying the primary contact, the intent
as the next move, and every required context item into its matching tier. It is
idempotent per prospect: a second handoff of the same prospect returns the
relationship already open rather than a duplicate, enforced both by the receiver
and by a unique index on `(organization_id, prospect_id)`.

## Operating views (Clients / Nurture / Needs you / All)

One `comms_relationships` record per person, one continuous history, four
calm reads of the same derived state — never a pipeline, never a second
prospect or client copy. Scout finds people worth knowing; Comms makes sure
the right relationships actually go somewhere. The views exist so hundreds
of Scout/outbound prospects can never crowd the established-client room.

- **Clients** (default): established clients and meaningful existing
  relationships. Kept deliberately calm and small.
- **Nurture**: people Trust Tai has deliberately chosen to develop after a
  Scout handoff or approved outreach. Prioritized by attention, next move,
  and recency — never a giant undifferentiated list.
- **Needs you**: cross-cutting. Anyone in Clients or Nurture where human
  judgment is required — a reply owed, a promise open, a real reason with
  urgency. It reuses the existing conversation-health and next-move reads;
  there is no parallel rules engine.
- **All**: the complete relationship ledger, everyone exactly once,
  archived included.

Segment classification is derived, never stored, and follows current
relationship reality rather than the door the person entered through
(`relationshipSegment` in `src/domain/comms.ts`). Established evidence wins
first, development evidence second, and a safe fallback keeps legacy rows
visible:

1. **Established evidence → Clients.** A linked client record (`client_id`),
   a graduated stage (`meeting_set`, `opportunity`, `client`), or an
   explicit established intent (`active_client`, `past_client`, `partner`,
   `referral`, `community`, `vendor`, `personal`) — whatever the origin, and
   even when the row still carries Scout provenance or an early stage.
2. **Development evidence → Nurture.** An explicit `nurture` stage, an
   explicit `prospect` intent, a linked prospect (`prospect_id`), a
   `scout_handoff` origin, or an early lifecycle stage (`new`, `researching`,
   `ready_to_reach`, `reached_out`). Source alone never decides, but an
   early stage does: `new` + `in_person` (met at an event, early days) is
   Nurture, and so is `new` + `inbound` with no client evidence.
3. **Contextual stages.** `in_conversation` and `dormant` follow the
   evidence: prospect/Scout/early evidence keeps them in Nurture, client
   evidence puts them in Clients. A conversation alone never makes someone
   a client.
4. **Safe fallback → Clients.** A legacy `manual`/`in_person`/`inbound` row
   at a contextual stage with no development evidence stays in the client
   room rather than vanishing.

Worked examples: Lorena is a prospect, stage `new`, met in person → Nurture.
A Scout handoff in active conversation (`in_conversation`, `prospect_id`
set) → Nurture. The same person once marked as client (stage `client`) →
Clients, same record, same history. A dormant relationship with a
`client_id` → Clients; a dormant Scout handoff → Nurture.

**Moving between rooms.** Nurture → Clients is "Mark as client" (stage
becomes `client`). Clients → Nurture is "Move to Nurture", offered only when
the client classification rests on contextual fallback — never when a linked
client record, a graduated stage, or an explicit established intent says
otherwise (`canMoveToNurture`). Both are stage changes on the same record;
nothing is ever copied, migrated, or re-created.

**Pagination.** Each view renders 25 relationships per page
(`RELATIONSHIPS_PER_PAGE` in `src/data/comms-inbox.ts`), sliced only after
the full view is derived: tab counts, health counts, and search always
describe the whole view, never the page on screen. Changing tab, search, or
health filter returns to page one; changing page falls selection back to the
page's first row when the open conversation is not on it. Priority rows
(attention first, then longest waiting) lead every page — Nurture is ordered
by intelligence, never alphabet.

**Scale boundary.** Health reads use the organization's most recent 5,000
touches (paged in batches of 1,000, newest first). Beyond that bound, quieter
relationships degrade gracefully: health falls back to the denormalized
`last_touch_at` on the relationship row rather than inventing activity. The
honest next step past that scale is server-side per-view queries, not a
larger client cap.

**Color language.** Classification and condition never share a hue.
Classification: Clients royal blue, Nurture soft plum (`--plum`), archived
muted. Health stays green / amber / red / quiet gray. A row answers who this
is, what kind of relationship it is, and whether anything is needed — in
that order, in about two seconds.

**Entry rules.** A Scout discovery alone never creates a Comms relationship.
A person enters Comms only through an intentional event: approved outreach,
a Scout handoff for relationship development, inbound contact, a booked
meeting, or an explicit Add to Comms. The Scout → Comms handoff receiver is
the only handoff path.

**Graduation.** Nurture → Clients is a stage change on the same record
("Mark as client" in the rail): every email thread, Scout provenance,
interaction, promise, learning, draft, health read, and memory stays
exactly where it is. Nothing is copied, migrated, or re-created.

**Automation ends where relationship begins.** When someone replies
meaningfully they stop being an outbound target and become a real
conversation — held by the same record, read by the same health and
next-move logic as any client.

**Comms agent continuity mission** (standing responsibility for the future
Paperclip Comms agent): *Protect and develop every relationship Trust Tai
has deliberately chosen to care about.*

### Gmail continuity rules

- Once a person is approved into Comms, their known email identity belongs
  to that relationship; a new Gmail thread from the same approved email is
  a new conversation under the same relationship, never a new person.
- `Trust Tai/Comms` remains the Gmail ingestion boundary — label gate
  first, identity match second; reading never mutates labels.
- Sending is a separate, explicit act: a reply leaves only when a person
  clicks Send on an approved draft, over the `gmail.send` grant. Comms
  never sends on its own, and `gmail.modify` is never requested — labels
  stay Tai's alone.
- Automation may recommend or prepare Gmail-native filters and continuity
  mechanisms, but no Gmail mutation permissions are granted; applying them
  stays Tai's act, in Gmail.
- A changed or new email identity requires human confirmation before
  merging into a relationship.

### Continuity examples (maintenance reference)

**Multi-thread, same approved email.**
Tai adds `jane@acme.co` to Comms from a Gmail thread labeled `Trust Tai/Comms`.
A month later, a different Gmail thread with Jane arrives, also labeled
`Trust Tai/Comms`, about a new topic. The sync must store the second thread under
Jane's existing relationship (`comms_relationships` row), not create a new
relationship or contact. Both threads appear in her conversation history; the
new topic is simply a new thread under the same person.

**Same approved email, new conversation.**
`jane@acme.co` is already in Comms. A fresh labeled inbound message from
`jane@acme.co` appears in Gmail. The message is stored as a new message under
Jane's existing relationship and thread. No human confirmation is needed because
the From address is already an approved identity for that relationship.

**Changed/new email identity — requires human confirmation.**
A labeled Gmail thread arrives from `jane.smith@acme.co`, but the existing
relationship for Jane is tied to `jane@acme.co`. Even if the display name or
domain matches, the new address is not yet approved for that relationship. Comms
must surface the new email for human review (e.g., "Jane also emailed from
jane.smith@acme.co — merge into the existing relationship?"). Until confirmed,
the message is treated as pending/unknown, not stored under the original
relationship, and no new relationship is auto-created. After confirmation, the
new address becomes an approved identity on the same relationship and future
messages from it attach automatically.

**What must never happen.**
- Auto-creating a second relationship, contact, or duplicate record because the
  same person appears on a new thread.
- Treating a changed or secondary email as the same identity without human
  confirmation.
- Auto-merging two people who share a company or display name but are not the
  same individual.
- Reading or storing unlabeled Gmail, or adding/removing Gmail labels, to make
  continuity "work."

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
service role. Consent requests `gmail.readonly` plus `gmail.send` — never
`gmail.modify` — and the granted set is persisted on the connection row, so
the send capability check tells the truth.

## Gmail track (labeled read + human-approved send)

Credentials live on the server only: `GOOGLE_OAUTH_CLIENT_ID`,
`GOOGLE_OAUTH_CLIENT_SECRET`, plus `COMMS_TOKEN_ENC_KEY` and
`COMMS_OAUTH_STATE_SECRET`. The browser never sees any of them.

### Multi-mailbox

Mailboxes own transport identity. Relationships own memory.

A member can connect more than one Gmail mailbox. Every synced message and
every Comms-sent row stamps `provenance.mailbox` with the mailbox that
observed or sent it, so one relationship may hold conversations from multiple
connected Trust Tai mailboxes — one person, one memory, many conversations.
Replies always stay with the mailbox that owns the Gmail thread (provenance,
never a guess, and never an explicit From choice); a brand-new outbound
message only offers a From selector when more than one connected mailbox can
send — with a single send-capable mailbox the choice is automatic and
invisible. A mailbox whose grant lacks `gmail.send` blocks only that mailbox,
naming it; a send is never silently rerouted to another account. Each
mailbox keeps the same `Trust Tai/Comms` label as its read boundary.

Registered redirect URI (exact match required by Google):

- production: `https://cmd.trusttai.com/api/public/comms/gmail/connect` — the
  deterministic constant (`GMAIL_PRODUCTION_REDIRECT_URI`); every
  production-shaped request resolves to it.
- preview/development: the request origin's own callback, or set
  `GOOGLE_OAUTH_REDIRECT_URI` to override. Any preview URI used must also be
  listed in the Google OAuth client.

Flow:

1. A member clicks Connect. The server signs a state (organization + return
   path + issue time) and returns Google's consent URL. Scopes requested:
   `gmail.readonly` plus `gmail.send`, with `prompt=consent` and
   `include_granted_scopes=true` so reconnecting an older read-only
   connection upgrades the grant cleanly without dropping what was already
   allowed. `gmail.modify` is never requested — Comms cannot change labels
   by construction. The scopes Google actually grants are persisted on
   `comms_integrations.scopes` exactly as reported.
2. Google calls back to `/api/public/comms/gmail/connect`. That callback has no
   Trust Tai session, so it touches no data: it verifies the signed state and
   bounces the browser back to `/modules/comms/integrations` with the code.
3. The signed-in page posts the code back. The server exchanges it, reads the
   mailbox address, writes `comms_integrations`, and stores the refresh token
   sealed with AES-GCM through `comms_put_integration_secret`. Even a member
   reading that value back gets ciphertext.
4. A pass is bounded and label-gated. The ingestion boundary is the Gmail
   label `Trust Tai/Comms`: its id is resolved from Gmail's own `/labels`
   list (matching the full nested path, never a free-text `label:` search,
   which would split on the space and slash), and every message listing is
   constrained by that label id plus the overlap window. Unlabeled mail —
   promotions, newsletters, alerts, even mail with a person Comms knows —
   never enters Comms at all. Listing is capped at 60 messages over the
   window. A missing label fails safe with a clear "Needs attention" status;
   there is no whole-mailbox fallback. Upserts key on
   `(organization_id, provider, provider_message_id)`, so repeat passes are
   idempotent. Thread state and the response clock come from the pure
   `readThread` reading, not from Gmail. Comms never adds, renames, or
   removes Gmail labels — labeling is Tai's act, in Gmail.

### Doctrine — the label is the approval

**Applying the exact `Trust Tai/Comms` Gmail label is the human approval to
bring that correspondent into Comms. Normal intake after that is automatic;
only ambiguity or failure asks Tai to intervene.**

What follows from that, and is enforced in code:

- A labeled message whose counterpart Comms already tracks attaches to that
  relationship. No duplicate person, no duplicate relationship.
- A labeled message whose counterpart is unknown brings that person in
  automatically, through the canonical path: one shared `contacts` row
  (matched by normalized email first, created only when absent), then one
  `comms_relationships` row for that person, then the labeled history within
  the same bounded window. There is no Gmail-specific people table.
  (`src/lib/comms-intake.server.ts`.)
- There is no second approval. No import queue, no "Show people", no
  checkbox selection, no per-person "Add to Comms" for a correspondent the
  label already approved. That surface has been retired.
- Intake infers a person and nothing else. No organization, no client, no
  lifecycle promotion — the relationship starts where governed rules start it.
- Provenance is kept: the Gmail label, the mailbox identity, the first
  observed thread and message, and their timestamps live on
  `metadata.gmail_intake`, and one `relationship.created` activity carries a
  dedupe key naming the person.
- Ambiguity fails closed, not open. A labeled outbound thread with more than
  one human recipient — or a create that failed — is recorded on
  `cursor.intake_exceptions` (capped, deduped by message id) and surfaced on
  Connections as "Needs your decision", retryable, never guessed at and never
  silently dropped. `resolveIntakeCounterpart` (`src/domain/comms-intake.ts`)
  makes that call; machine addresses are never people.
- Reading is proactive. The 6-hourly scheduled sweep is the normal path;
  "Sync now" is an optional recovery action, and the connection reads
  "Watching Trust Tai/Comms · last checked …".
5. Coverage is visible, not assumed. Every pass persists a counts-only
   summary on the connection (`cursor.last_run`: messages read and stored,
   people added, events emitted, drafts verified, and `pending_people` — the
   exceptions still awaiting a decision). The Connections card reports the
   last pass verbatim without re-reading the mailbox.

Label gating and coverage were verified in production on 2026-08-22 against
the real connected mailbox: the authorized scheduled sweep read only the
1 labeled message in the window (14 before gating) and an immediate repeat
run was fully idempotent. Automatic label-as-approval intake is
implementation- and test-verified as of this change; production verification
of an unknown labeled correspondent is still pending.


### Send path (ready for re-consent; real sending not yet production-verified)

Replies leave through a deterministic state machine (`draft → approved →
sending → sent → mailbox_verified`; `src/domain/comms-send.ts`,
`src/lib/comms-gmail-send.server.ts`). A human click on Send is the only
trigger — there is no autonomous sender. The composer enables Send only when
the persisted grant includes `gmail.send`; an older read-only connection
shows a calm "Reconnect with send access" affordance instead. Idempotency
keys on `send:{draftId}`; a failed Gmail call lands in retryable
`send_failed` with the draft and its staged files intact, and threading
headers (`In-Reply-To` / `References`) keep the reply in its conversation.
As of 2026-08-22 the app is **ready for the Gmail send re-consent and
production test**: publish, reconnect Google once to grant `gmail.send`,
then send one real reply and confirm it lands in Gmail's Sent mail. Until
that run, real sending is **not production-verified**.

Onboarding backfill (Add to Comms brings history with it) was implemented on
2026-08-22 — composition and clamp unit-tested (`src/data/comms-onboarding.*`),
typecheck clean — but is **not yet production-verified**; a live Add-to-Comms
run against the real mailbox is still required before marking it verified.

Body retention is off: only snippets are stored. `comms_messages.body_text`
exists for a later opt-in and is never written today.

Requires `docs/comms-integrations-schema.sql` to be applied in the Trust Tai
Supabase project, including the two SECURITY DEFINER credential functions at
the end of that file.

## Roadmap recognition listens to them, never to us

The Roadmap opportunity read in the conversation room runs on
counterparty-authored evidence alone (`counterpartyEvidence` in
`src/data/relationship-development.ts`):

- INBOUND email/SMS, with quoted reply history and signatures stripped by the
  one shared quoted-content logic — an inbound reply quoting our earlier email
  can never read our language back as their need.
- INBOUND recorded interactions, and captures a person explicitly marked as
  "their own words" (`provenance.their_words`); our notes and hypotheses are
  excluded by default.
- Outbound mail, drafts, suggestions, and system-generated text are excluded
  always. Generic warmth ("growth", "next steps", "stay connected") never
  matches; only specific operational tangles do, and the panel shows their
  exact sentence, not a wall of email.

The read never auto-creates a Roadmap, never inserts a pitch, and never adds
a CTA. Tai decides. The goal of any outreach remains to earn the next natural
exchange, not a meeting. Text stays a protected channel everywhere: Comms
recommends it only on explicit text-route evidence.
