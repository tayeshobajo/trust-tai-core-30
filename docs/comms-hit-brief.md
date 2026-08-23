# Comms Hit Brief — audit against the Familiar Magic doctrine

Read-only audit of the current implementation, dated 2026-08-22, judged against
"Product law — Familiar Magic" in `docs/architecture-canon.md`. Comms is next
in the locked migration order (Core/Foundation → Comms → …), so this brief is
the baseline its next phase must satisfy.

**Locked hit behavior: "Help me never lose an important relationship."**

## What exists today

**Screens/routes.** `/modules/comms` (`src/routes/modules.comms.index.tsx`),
plus `/modules/comms/voice` and `/modules/comms/integrations`. Components in
`src/components/tt/comms/`: `comms-inbox.tsx` (queue), `conversation-room.tsx`
(workspace), `relationship-rail.tsx` (context/next move), `capture-form.tsx`,
`mailbox-import.tsx`, `add-interaction.tsx`, `edit-interaction.tsx`,
`reply-record.tsx`, `health-marks.tsx`, `gmail-connection.tsx`,
`integrations-panel.tsx`, `relationship-export.tsx`.

**Data model.** Live: `comms_relationships`, `comms_threads`, `comms_touches`,
`comms_drafts`, `comms_reminders`, `comms_voice_profiles`
(`docs/comms-v1-schema.sql`, header marked APPLIED). Integration layer:
`comms_messages`, `comms_integrations`, `comms_events`, `comms_event_targets`
and thread columns (`docs/comms-integrations-schema.sql`) — **verified APPLIED
in production on 2026-08-22**, including the service-role credential read
`comms_get_integration_secret_system`. `comms_events` / `comms_event_targets`
are referenced by no other code anywhere. Access layer:
`src/data/supabase/comms-service.ts`, `comms-schema.ts`,
`comms-messages.ts` (timeline read); RLS via `private.is_org_member`.

**Integrations.** Gmail connect / candidates / sync routes under
`src/routes/api/public/comms.gmail.*`; server logic in
`src/lib/comms-gmail.server.ts` (660 lines); refresh-token upkeep in
`supabase/functions/comms-gmail-refresh`. Scope is `gmail.readonly` — sending
is impossible by construction. Refresh tokens are AES-GCM sealed
(`comms-crypto.server.ts`), readable only by the service role. Sync runs two
ways over one shared core: person-invoked (member bearer token, RLS holds) and
**scheduled** (`/api/public/comms/gmail/scheduled-sync`, service role via the
system credential RPC, cron-secret auth, every 6 hours — cron SQL in
`docs/comms-integrations-schema.sql`). The production cron is active and verified:
`comms-gmail-sync` at `17 */6 * * *`, secret sourced from Supabase Vault
`comms_sync_cron_secret`, endpoint fail-closed (401/200). Drafting endpoint:
`src/routes/api/public/comms.draft.ts` → `src/lib/comms-draft.server.ts`.

**Agent behavior.** Drafting reasons through the shared intelligence runtime
(`runtimeModelCaller` from `src/lib/intelligence-runtime.server.ts`), then
passes the deterministic Voice DNA checker (`src/data/voice-policy.ts`,
`src/domain/voice.ts`). Reminders (`src/data/comms-reminders.ts`) and the next
move (`src/data/comms-next-move.ts`) are pure deterministic functions with
evidence. No autonomous agents; nothing is sent.

## The ten hit-test answers

1. **Job.** Keep every important relationship alive on purpose: one queue, one
   state per person, one truthful reason to reconnect. Holds today.
2. **Hit behavior.** "Help me never lose an important relationship." The
   return trigger is the *Needs you* tab (`src/data/comms-inbox.ts`,
   `tabOf`: `waitingOn === "needs_us"`) plus attention state
   (`src/data/comms-attention*.ts`). Real, but the loop only completes when
   the mailbox is synced — see capability c/d.
3. **Familiar reference.** An email client / lightweight CRM: list left,
   chronological thread centre, context right. Familiar on the surface —
   the doctrine's surface law is satisfied by the current shape.
4. **Magic.** Tiered memory (observed / inferred / decided,
   `src/domain/comms.ts`), a next move that only exists when something true
   supports it (`comms-next-move.ts`), voice-checked drafts, and a response
   clock read from real mail rather than a cadence guess.
5. **Intelligence.** Retrieves relationship memory, reasons-to-reconnect and
   the org Voice DNA; reasons through the shared runtime; verifies drafts
   deterministically (`voice-policy.ts`). Does not yet retrieve Scout people
   research at draft time (capability g).
6. **Actions.** Capture, log/edit/retract interactions, stage changes,
   compose + approve drafts, mark sent, import a correspondent from the
   mailbox, sequence in Roadmap. Cannot send — deliberately.
7. **Human gates.** Stage only changes by a person; blocking voice violations
   prevent approval; the sensitive register is always held for review
   (`HUMAN_REVIEW_REGISTERS`); a person marks a draft sent; Scout handoff is
   person-initiated (`scout-service.ts` `routeToComms`).
8. **Memory.** Memory tiers per relationship, commitments with due dates
   (`comms-interactions.ts`), the Voice DNA profile, the touch history.
   Draft edits leave no memory — the largest single leak (capability j).
9. **Proof.** `last_touch_at` only moves on a logged touch or a synced
   message, so coverage is honest. "Marked as sent" (human claim) and
   "seen in the mailbox" (observed proof) are now distinct states, reconciled
   only by credible evidence — attempted != executed != verified holds.
10. **Subtraction.** Candidates: the Phase-0 `comms_events` /
    `comms_event_targets` track with its deliberately empty registry, and any
    integration-panel track that cannot connect. Keep hidden until a provider
    is approved; do not let them occupy attention.

## Capability classification

| Capability | Verdict | Evidence |
| --- | --- | --- |
| Familiar chronological thread, manually updatable with notes/context | **Exists** | `src/data/comms-timeline.ts` folds touches + drafts oldest-first with per-entry provenance; `recordNote` / `editedProvenance` in `src/domain/comms-touch-record.ts`; `add-interaction.tsx`, `edit-interaction.tsx`. |
| Matching known people to Gmail by email identity | **Exists** | Sync matches From/To/Cc counterparts against `comms_relationships.email`, lowercased (`findTrackedCounterpart` in `comms-gmail.server.ts`) — the identity layer applied after label gating; capture matches the shared `contacts` table by email then exact name (`comms-service.ts`); `listMailboxCandidates` marks `alreadyTracked`. |
| Pulling incoming Gmail into relationship history | **Exists / Verified** | `comms_messages` upsert idempotent on `(organization_id, provider, provider_message_id)`; only genuinely new messages count as stored. Synced mail folds chronologically into the existing `conversationTimeline` with plain provenance ("Synced from Gmail · read-only") — no `comms_touches` duplication (`src/data/comms-timeline.ts`, `src/data/supabase/comms-messages.ts`). New inbound mail emits one canonical `relationship.message_received` into `activities` with a `source_event_key`, deduped by pre-check + the unique index (`emitInboundEvents` in `comms-gmail.server.ts`), so Pulse/Steward see it. Sync is scheduled (`comms-gmail-sync` cron, `17 */6 * * *` in the production Trust Tai Supabase project). Production verification on 2026-08-22 confirmed a real connected mailbox: tracked-people mail is found, stored, and emitted; a repeat sync produced zero new stores and zero new events. **Ingestion boundary hardened and production-verified 2026-08-22:** sync is now label-gated on the Gmail label `Trust Tai/Comms` — the label id is resolved from Gmail `/labels` and constrains every message listing, so unlabeled mail never enters the candidate set, even when it involves a known address. Labeled mail with people not yet in Comms is counted, left unstored, and surfaced for review through the existing mailbox import. A missing label fails safe with a clear status; there is no whole-mailbox fallback. |
| Pulling Tai's sent replies into the same history | **Exists** | SENT mail is stored with outbound direction and appears in the same thread. A draft marked sent is reconciled against observed outbound mail by the deterministic matcher (`src/domain/comms-verification.ts`: direction + recipient + send window + subject or opening-words fingerprint; ambiguity never matches). A proven draft's rationale carries `verification` and the thread says "Sent — seen in the mailbox" versus "Marked as sent — not yet seen in the mailbox". |
| Freshness/momentum monitoring, contextual not crude N-day | **Partial** | Contextual reads exist: `deriveConversationHealth` produces response cadence (`responsive/steady/slowing/unanswered`) and momentum (`warm/stable/cooling/stalled`) from actual rhythm (`src/domain/comms-health.ts`), and the next move uses per-intent rhythm days (`rhythmDaysFor`). But the shared timing read `dueState` still falls back to a flat `DORMANT_AFTER_DAYS = 45` timer (`src/domain/comms.ts`). Both live side by side; the queue tabs lean on `waitingOn`, the doc-described buckets on the timer. |
| Scout → Comms handoff at an ICP threshold | **Missing (manual by design today)** | Handoff is person-initiated: `routeToComms` in `src/data/supabase/scout-service.ts:548` gates on `buildHandoffDraft.ready` (evidence completeness), never on score. Scoring doctrine (`src/domain/scout-fit.ts`) defines the 0–100 score; `src/data/scout/decision-state.ts` holds narrative gates `STRONG_SCORE = 68` / `WEAK_SCORE = 32` used only to phrase the decision read — no handoff threshold exists, and "60" appears nowhere. Architecture-canon handoff law already says weak evidence must not open the next room, so any threshold trigger must be an org-configurable recommendation, not an automatic room-open. |
| Pre-outreach research/enrichment before drafting | **Missing in Comms** | People enrichment lives in Scout (`src/data/people/registry.ts`, `enrichment.ts`) and is unreachable from the drafting path; `integrations-panel.tsx` lists enrichment as needing "an approved enrichment provider account". `draftMessage` composes from relationship memory only. |
| Drafting in Tai's voice using voice/canon/memory assets | **Exists** | Per-org `comms_voice_profiles` (editable at `/modules/comms/voice`), deterministic enforcement in `src/data/voice-policy.ts`, runtime reasoning in `src/lib/comms-draft.server.ts` citing observed facts and human decisions only. |
| Approval before external send | **Exists** | Review states `draft → needs_human_review → approved → sent`; blocking violations prevent approval; Comms structurally cannot send (`gmail.readonly` only; no send path in code). |
| Learning from Tai's edits to drafts | **Missing** | The only draft mutation is review-state change (`comms-service.ts` "That draft could not be updated"); no diff capture, no voice calibration feedback, no append-only record of what Tai changed. Interaction edits have provenance; draft edits have none. |
| Provenance — why Comms recommends a follow-up | **Exists** | `reasonsToReconnect` returns `ReasonCode` + `reasonText` + `EvidenceRef[]` per reason; `nextRelationshipMove` carries evidence; handoff memory items keep their evidence lanes. An empty reason list is a valid answer by design. |

## Architectural gaps to close before any UI redesign

Smallest set, in dependency order:

1. **(Closed 2026-08-22)** ~~The synced-mail seam ends at the database.~~ `comms_messages` and
   `comms_threads` are written by sync and read by no one. One read path —
   folding synced messages into `conversationTimeline` with their existing
   provenance — closes capabilities c and d together. No new tables, no new
   UI concepts: the thread simply becomes complete. The same seam should emit
   the existing `RELATIONSHIP_MESSAGE_RECEIVED` suite event when inbound mail
   lands, so Pulse and Steward can see what the mailbox already knows.
2. **(Closed 2026-08-22)** ~~Sent verification.~~ A draft marked sent is a claim; the actual sent
   message arrives via sync but is never linked to the draft. The proof law
   (attempted != executed != verified != human accepted) needs the join by
   thread/recipient/time so the timeline can say "sent — seen in the mailbox"
   versus "marked as sent".
3. **Draft-edit memory.** Capture the final edited text at approve / mark-sent
   time, diff against the generated body, and append the correction to voice
   calibration. This is the suite's memory law applied to the one loop Comms
   runs every day; today the loop teaches nothing.
4. **Handoff trigger doctrine, not a hard-coded number.** Any "crossed my ICP
   threshold" behavior must be an org-level configurable recommendation
   surfaced in Scout, accepted by a person, received idempotently as today.
   Scoring has no threshold concept yet; introducing one is product policy and
   belongs in the doctrine discussion, not in a constant.
5. **Enrichment stays Scout-owned.** Pre-outreach research before drafting
   should be a request back through the existing handoff/routing contract
   ("context is stale, refresh the people brief"), surfaced in the next-move
   rail. Building a provider inside Comms would be wrong ownership.
6. **(Closed 2026-08-22)** ~~The Gmail track is code-live but backend-inert.~~
   Production verification is complete: the `comms-gmail-sync` cron is applied
   and active in the Trust Tai Supabase project (schedule `17 */6 * * *`, target
   `https://cmd.trusttai.com/api/public/comms/gmail/scheduled-sync`, secret
   sourced from Supabase Vault `comms_sync_cron_secret`). The endpoint is
   fail-closed (missing key → 401, valid configured key → 200). A real Gmail
   account (`tayeshobajo@gmail.com`) is connected. Commit
   `0f068d32df94e5183384408f8a3a9d2b0907eec6` hardened the sync to known-
   correspondent-first queries so mailbox noise cannot crowd out tracked
    relationships; a controlled fixture confirmed sent-draft reconciliation;
    immediate re-runs confirmed message/event idempotency. The read-only Gmail
    boundary and no-auto-create-relationship rule remain locked. **Product/data
    observation**: the live workspace currently has sparse relationship identity
    coverage, so most real Gmail correspondents are not yet Comms relationships.
    This is a relationship-onboarding/import product concern, not a Gmail defect;
    Gmail must continue to store only people already tracked in Comms.
    **Refinement 2026-08-22 (implemented and production-verified 2026-08-22)**: ingestion is
    now label-gated on Tai's `Trust Tai/Comms` Gmail label. The label is the
    first Gmail-side filter; identity matching against `comms_relationships`
    remains the storage-decision layer after it. Labeled-but-unknown people are
    surfaced through the existing mailbox import as "Labeled in Gmail, not yet
    in Comms" (Add to Comms or ignore — a human decision), which directly
    answers the sparse-coverage observation above without any auto-creation.

## Recommended implementation sequence

Familiar interaction, exceptional reasoning underneath, minimal surface
complexity — in this order:

1. **Complete the thread.** Surface synced mail (both directions) inside the
   existing timeline. The familiar model — "the conversation, in order" —
   becomes true. This alone makes the hit behavior real: an unanswered inbound
   now actually lands in *Needs you*.
2. **Make proof visible.** Link approved drafts to observed sent messages;
   the response clock then measures reality end to end.
3. **Let edits teach.** Draft-edit capture feeding voice calibration. No new
   surface; drafts simply need fewer corrections over time.
4. **Threshold as recommendation.** Org-configurable ICP watch in Scout that
   proposes the handoff; the person accepts; the receiver is already
   idempotent.
5. **Stale-context recall.** When drafting against thin or old context, the
   next-move rail recommends a Scout people-brief refresh through the existing
   contract.
6. **Only then** consider surface redesign, with the subtraction law as the
   gate: anything that does not help Tai reach the outcome faster, more
   confidently, or with less effort does not survive.

## Implementation pass 2026-08-22 — verification record

Sequence items 1 and 2 and the "synced-mail seam" event emission are done with
no UI redesign. The Gmail sync foundation was then fully verified in production
on 2026-08-22. What was verified, and how:

- **Backend**: production probes against the Trust Tai Supabase project
  confirmed `comms_integrations`, `comms_messages`, thread columns, grants,
  both credential functions (member and service-role variants), and the system
  RPC for cron-secret storage (`comms_set_cron_secret_system`) — no data
  touched. Schema doc header updated to APPLIED.
- **Timeline truth**: `src/data/comms-timeline.test.ts` — synced inbound and
  outbound messages fold chronologically beside touches and drafts with
  provenance, dedupe against un-synced touches on the same ref, and no
  `comms_touches` rows are fabricated.
- **Draft verification**: `src/domain/comms-verification.test.ts` (15 tests) —
  matches on recipient + window + subject/fingerprint, never fabricates on
  ambiguity or thin content, 21-day expiry, observed-mail provenance wins.
- **Idempotency**: message storage upserts on the provider key; the inbound
  event carries a deterministic `source_event_key` guarded by a pre-check and
  the existing partial unique index on `activities.source_event_key` — a
  resync stores nothing twice and emits nothing twice.
- **Fail-closed**: the scheduled endpoint returns 401 on a missing or wrong
  key, and 200 with the configured secret. Verified live at
  `https://cmd.trusttai.com/api/public/comms/gmail/scheduled-sync`.
- **Cron**: exactly one active `comms-gmail-sync` cron in production
  (`17 */6 * * *`), using `pg_cron` + `pg_net`, target `https://cmd.trusttai.com/api/public/comms/gmail/scheduled-sync`,
  secret read from Supabase Vault (`comms_sync_cron_secret`).
- **Known-correspondent-first sync**: commit `0f068d32df94e5183384408f8a3a9d2b0907eec6`
  changed the sync to load tracked `comms_relationships` emails first and build
  scoped Gmail queries (`from:email OR to:email`) before any message-list
  call. This ensures mailbox noise cannot crowd out tracked relationships. The
  locked boundary that Gmail only reads/stores existing Comms relationships was
  preserved; no auto-create behavior was introduced.
- **Real-correspondent QA**: a temporary, explicitly labeled John Schmidt
  relationship was used against messages already present in Gmail (no email sent
  by Comms). Result: `messagesRead=14`, `messagesStored=13`,
  `relationshipsTouched=1`, `skippedUnknownPeople=0`, `eventsEmitted=7`. An
  immediate repeat via the exact cron HTTP command returned `messagesRead=14`,
  `messagesStored=0`, `skippedUnknownPeople=0`, `eventsEmitted=0`, proving
  message and event idempotency and that the cron timeout path completes.
- **Sent-draft reconciliation**: a controlled fixture matched an already-sent
  Gmail message by recipient + subject and returned `draftsVerified=1` /
  `mailbox_verified`. No new email was sent.
- **Cleanup**: QA relationship, contact, draft, messages, and events were
  removed afterward; production was restored clean.
- **Still explicit and deferred**: Tai-voice learning from draft edits, Scout →
  Comms handoff threshold, automated prospect research, freshness intelligence,
  autonomous sends, and any major UI redesign. These are product/architecture
  decisions, not unresolved Gmail plumbing.

### Label-gated ingestion (2026-08-22) — implemented, verified in production 2026-08-22

After Tai created the Gmail label `Trust Tai/Comms`, the ingestion boundary
moved from address-scoped queries to label gating:

- The label id is resolved from Gmail's own `/labels` list, matching the full
  nested path exactly (case-insensitive fallback; Gmail label names are
  case-insensitively unique). A free-text `label:` search was rejected because
  it splits on the space and slash in `Trust Tai/Comms`.
- Every message listing carries `labelIds=<id>` plus the existing overlap
  window (`newer_than:2d -in:spam -in:trash` scheduled). Unlabeled mail can
  no longer enter the candidate set at all — stronger than the previous
  known-correspondent-first scoping, which it replaces as the discovery
  filter. `findTrackedCounterpart` remains as the identity layer that decides
  what is stored.
- Labeled mail with people not yet in Comms is counted
  (`skippedUnknownPeople`), never stored, and surfaced through the existing
  mailbox import, now labeled "Labeled in Gmail, not yet in Comms" — a human
  Add-to-Comms or ignore decision. No relationship is ever auto-created.
- A missing label throws a clear, non-destructive error: the scheduled sweep
  records "Needs attention" with the reason, the member-invoked read shows
  the same message, and nothing falls back to whole-mailbox reading. An
  empty relationship list stays a clean no-op with zero Gmail work.
- Cron endpoint contract, auth (401/200), read-only scope, idempotency
  keys, event dedupe, and sent-draft reconciliation are unchanged. Comms
  never adds, renames, or removes Gmail labels.

Unit tests prove the boundary (`findCommsLabelId` exact/folded/missing,
`buildLabelListPath` label-first with no address terms). **Verified in
production 2026-08-22** against the deployed endpoint
(`https://cmd.trusttai.com/api/public/comms/gmail/scheduled-sync`) and Tai's
real connected mailbox: negative control without the cron key returned 401;
the authorized sweep returned 200 with `mailboxes=1, synced=1, failed=0` and
`messagesRead=1, messagesStored=0, relationshipsTouched=0,
skippedUnknownPeople=1, pendingPeople=1, eventsEmitted=0, draftsVerified=0`.
Before label gating the same mailbox and window read 14 messages; the gated
pass read exactly the 1 labeled message, and the 1 labeled-but-unknown
correspondent was counted and left unstored for review — never auto-created.
An immediate second authorized run returned identical counts with zero new
stores and zero new events, confirming idempotency. The `cursor.last_run`
write is fail-closed (a failed update throws and marks the mailbox failed);
both runs reported `ok: true`, so the status persistence path succeeded.

Test sweep at close: 1,245 passed, 0 skipped, 3 failed (unrelated pre-existing
Roadmap Studio failures).

### Coverage + status exposure (2026-08-22) — implemented, verified in production 2026-08-22

The sparse-coverage observation from the first audit becomes a visible
health check instead of a hidden state:

- Every sync pass persists a counts-only run summary on the connection
  cursor (`last_run`: read, stored, relationships touched, events emitted,
  drafts verified, `skipped_unknown_people`, and `pending_people` — distinct
  labeled correspondents not yet in Comms). The Connections card reports the
  last pass verbatim, so the status is visible without re-reading the
  mailbox. Counts only; never message content.
- The mailbox import now answers the coverage question directly — tracked
  versus pending among labeled correspondents — computed over the full read
  window before its display cap (`summarizeMailboxCoverage`). Adding a
  person remains the explicit preview → confirm → save flow; once added,
  their labeled mail stores from the next read on. No relationship is ever
  auto-created, and Gmail stays read-only with no label mutation.

Unit tests: `readGmailRunSummary` (well-formed / absent / malformed),
`summarizeMailboxCoverage` (tracked/pending split, empty window),
`counterpartAddresses` (participant extraction for the pending-people
count). Test sweep at close: 1,268 passed, 3 failed (the same unrelated
pre-existing Roadmap Studio failures).

Production-verified 2026-08-22 in the same authorized sweep above: the run
returned `pendingPeople=1` alongside `skippedUnknownPeople=1`, and the
fail-closed `cursor.last_run` write succeeded (both runs `ok: true`), so the
persisted last-pass summary the Connections card reads is live in
production.

### Onboarding backfill: Add to Comms brings history with it (2026-08-22) — implemented, not yet production-verified

Production QA exposed the gap: a labeled correspondent added through the
mailbox import stored no history until the next scheduled sweep, because the
member-facing sync was incremental and the scheduler runs on its own clock.
The rule is now: a relationship created from a labeled candidate is not
considered ready until a bounded labeled backfill has been attempted for
that person.

- Add to Comms composes the existing governed creation
  (`commsService.create`, email-deduped) with one member-authorized
  `syncGmail({ backfillDays: 30 })` pass (clamp 1–90 on both client and
  server). No new Gmail reader, no service-role bypass: the pass runs under
  the member's own token with RLS intact, label gate first, identity match
  second, 60-message cap, read-only, no label mutation, no send.
- A backfill failure after creation never rolls the relationship back; the
  UI surfaces "Added to Comms, but Gmail history could not be imported. Try
  sync again." and keeps the capture panel open next to the person.
- Progress is honest: "Adding to Comms…" during creation, "Bringing in
  labeled history…" during the backfill. On success the new relationship is
  selected and all Comms queries invalidate, so stored history appears
  without a reload.
- Idempotency is structural: creation dedupes on email per organization,
  message upserts key on `(organization_id, provider, provider_message_id)`,
  and event emission only fires for newly stored inbound.

Unit tests (`src/data/comms-onboarding.test.ts`): create-then-backfill
ordering, backfill failure keeps the relationship with a warning, creation
failure never reaches the backfill, already-tracked person returns the
existing relationship with a harmless repeat backfill, and the 1–90-day
clamp. Typecheck clean; existing `comms-gmail.server` suite (17 tests)
unaffected. **Production verification pending**: a live Add-to-Comms run
against the real mailbox is still required before this is marked verified.

### Operating views: Clients / Nurture / Needs you / All (2026-08-22) — implemented, not yet production-verified

The calm-client-room problem is now solved structurally rather than by
discipline: four operating views inside the existing Relationships
experience read one derived state, so Scout/outbound volume can never crowd
established clients. No schema migration was needed — `stage` + `source`
already carry the classification (`relationshipSegment` in
`src/domain/comms.ts`).

- **Classification (derived, evidence-first — refined 2026-08-22):** the
  segment follows current relationship reality, not the door the person
  entered through. Established evidence (linked `client_id`, graduated
  stage, explicit established intent) → Clients; development evidence
  (`nurture` stage, `prospect` intent, `prospect_id`, `scout_handoff`
  origin, early stage `new`/`researching`/`ready_to_reach`/`reached_out`) →
  Nurture; contextual stages (`in_conversation`, `dormant`) follow the
  evidence; a legacy row with no development evidence falls back to Clients
  so nobody vanishes. Worked rule: prospect + `new` + met in person →
  Nurture. No data was reclassified by guessing from weak signals; the
  reverse move ("Move to Nurture") is offered only when the client
  classification rests on contextual fallback (`canMoveToNurture`).
- **Views:** Clients is the default; Nurture is prioritized by the existing
  health/next-move ordering; Needs you cross-cuts both segments using
  `health.waitingOn === "needs_us"` plus `nextRelationshipMove` urgency —
  no parallel rules engine; All is the complete ledger, everyone exactly
  once, archived included (archived crowds no working room).
- **Graduation:** "Mark as client" in the rail runs the existing
  person-initiated stage change on the same record and emits the existing
  `relationship.stage_changed` event. Threads, Scout provenance, promises,
  drafts, health, and memory are untouched by construction.
- **Entry rules locked:** a Scout discovery alone never creates a
  relationship; entry requires handoff, approved outreach, inbound contact,
  a booked meeting, or explicit Add to Comms.
- **Laws recorded in `docs/comms-v1.md`:** "Automation ends where
  relationship begins" and the Comms agent continuity mission ("Protect and
  develop every relationship Trust Tai has deliberately chosen to care about"),
  including the Gmail continuity rules and concrete maintenance examples:
  multi-thread/same-approved-email must attach to the same relationship;
  changed or secondary email identities require human confirmation before
  merging; never auto-create a duplicate record or relax the label/read-only
  boundary.
- **Sidebar glance** reads the same view state: Needs you, Needs attention,
  At risk, Quiet — the Needs-you row switches view rather than filtering.

Tests: `src/domain/comms-segment.test.ts` (5) and
`src/data/comms-inbox.test.ts` (7) cover segment classification, view
membership, cross-cutting Needs-you, ledger completeness, and graduation on
the same record; `comms-health`, `comms-derive-health`, and
`comms-sidebar` suites updated to the new view model (56 passed across the
affected files). Gmail behavior untouched: label gate first, identity
match, read-only, no mutation, no send, bounded dedupe preserved.
**Production verification pending:** open the live workspace and confirm
existing relationships land in the expected rooms.
