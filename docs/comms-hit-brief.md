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
`docs/comms-integrations-schema.sql`). Drafting endpoint:
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
| Matching known people to Gmail by email identity | **Exists** | Sync matches From/To/Cc counterparts against `comms_relationships.email`, lowercased (`comms-gmail.server.ts:383-415`); capture matches the shared `contacts` table by email then exact name (`comms-service.ts`); `listMailboxCandidates` marks `alreadyTracked`. |
| Pulling incoming Gmail into relationship history | **Exists / Verified** | `comms_messages` upsert idempotent on `(organization_id, provider, provider_message_id)`; only genuinely new messages count as stored. Synced mail folds chronologically into the existing `conversationTimeline` with plain provenance ("Synced from Gmail · read-only") — no `comms_touches` duplication (`src/data/comms-timeline.ts`, `src/data/supabase/comms-messages.ts`). New inbound mail emits one canonical `relationship.message_received` into `activities` with a `source_event_key`, deduped by pre-check + the unique index (`emitInboundEvents` in `comms-gmail.server.ts`), so Pulse/Steward see it. Sync is scheduled (`comms-gmail-sync` cron, `17 */6 * * *` in the production Trust Tai Supabase project). Production verification on 2026-08-22 confirmed a real connected mailbox with known-correspondent-first queries: tracked-people mail is found, stored, and emitted; unknown mailbox noise is excluded from the candidate set entirely; a repeat sync produced zero new stores and zero new events. |
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

Test sweep at close: 1,245 passed, 0 skipped, 3 failed (unrelated pre-existing
Roadmap Studio failures).
