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
and thread columns (`docs/comms-integrations-schema.sql`, header marked
"Phase 0 — NOT YET APPLIED"). The Gmail code path that writes those tables is
live but the backend migration is not, so the whole track fails closed with a
real Postgres error today — see gap 6. `comms_events` / `comms_event_targets`
are referenced by no other code anywhere. Access layer:
`src/data/supabase/comms-service.ts`, `comms-schema.ts`; RLS via
`private.is_org_member`.

**Integrations.** Gmail connect / candidates / sync routes under
`src/routes/api/public/comms.gmail.*`; server logic in
`src/lib/comms-gmail.server.ts` (660 lines); refresh-token upkeep in
`supabase/functions/comms-gmail-refresh`. Scope is `gmail.readonly` — sending
is impossible by construction. Refresh tokens are AES-GCM sealed
(`comms-crypto.server.ts`), readable only by the service role. Sync is
**person-invoked only**: a POST with the member's bearer token from the UI; no
cron or scheduled pass exists anywhere. Drafting endpoint:
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
   message, so coverage is honest. But "marked as sent" is a human claim never
   reconciled with the observed sent message — attempted and verified are not
   yet distinguished (gap 2).
10. **Subtraction.** Candidates: the Phase-0 `comms_events` /
    `comms_event_targets` track with its deliberately empty registry, and any
    integration-panel track that cannot connect. Keep hidden until a provider
    is approved; do not let them occupy attention.

## Capability classification

| Capability | Verdict | Evidence |
| --- | --- | --- |
| Familiar chronological thread, manually updatable with notes/context | **Exists** | `src/data/comms-timeline.ts` folds touches + drafts oldest-first with per-entry provenance; `recordNote` / `editedProvenance` in `src/domain/comms-touch-record.ts`; `add-interaction.tsx`, `edit-interaction.tsx`. |
| Matching known people to Gmail by email identity | **Exists** | Sync matches From/To/Cc counterparts against `comms_relationships.email`, lowercased (`comms-gmail.server.ts:383-415`); capture matches the shared `contacts` table by email then exact name (`comms-service.ts`); `listMailboxCandidates` marks `alreadyTracked`. |
| Pulling incoming Gmail into relationship history | **Partial** | Stored: `comms_messages` upsert idempotent on `(organization_id, provider, provider_message_id)`; thread state via `readThread`; relationship `last_touch_at` / `response_due_at` updated (`comms-gmail.server.ts:425-505`). But nothing outside the sync module ever reads `comms_messages` or `comms_threads` — verified by repo-wide search — so synced mail never appears in the timeline. Three further limits: sync is person-invoked (no schedule), it writes no `comms_touches` rows, and inbound mail emits no `RELATIONSHIP_MESSAGE_RECEIVED` suite event, so Pulse/Steward cannot see it. |
| Pulling Tai's sent replies into the same history | **Partial** | The sync query (`newer_than:Nd -in:spam -in:trash`, line 378) has no label restriction, so SENT is included; direction is derived (`from === mailbox → outbound`, line 203) and stored. Same surfacing gap as above. A draft marked sent is never reconciled with the observed sent message. |
| Freshness/momentum monitoring, contextual not crude N-day | **Partial** | Contextual reads exist: `deriveConversationHealth` produces response cadence (`responsive/steady/slowing/unanswered`) and momentum (`warm/stable/cooling/stalled`) from actual rhythm (`src/domain/comms-health.ts`), and the next move uses per-intent rhythm days (`rhythmDaysFor`). But the shared timing read `dueState` still falls back to a flat `DORMANT_AFTER_DAYS = 45` timer (`src/domain/comms.ts`). Both live side by side; the queue tabs lean on `waitingOn`, the doc-described buckets on the timer. |
| Scout → Comms handoff at an ICP threshold | **Missing (manual by design today)** | Handoff is person-initiated: `routeToComms` in `src/data/supabase/scout-service.ts:548` gates on `buildHandoffDraft.ready` (evidence completeness), never on score. Scoring doctrine (`src/domain/scout-fit.ts`) defines the 0–100 score; `src/data/scout/decision-state.ts` holds narrative gates `STRONG_SCORE = 68` / `WEAK_SCORE = 32` used only to phrase the decision read — no handoff threshold exists, and "60" appears nowhere. Architecture-canon handoff law already says weak evidence must not open the next room, so any threshold trigger must be an org-configurable recommendation, not an automatic room-open. |
| Pre-outreach research/enrichment before drafting | **Missing in Comms** | People enrichment lives in Scout (`src/data/people/registry.ts`, `enrichment.ts`) and is unreachable from the drafting path; `integrations-panel.tsx` lists enrichment as needing "an approved enrichment provider account". `draftMessage` composes from relationship memory only. |
| Drafting in Tai's voice using voice/canon/memory assets | **Exists** | Per-org `comms_voice_profiles` (editable at `/modules/comms/voice`), deterministic enforcement in `src/data/voice-policy.ts`, runtime reasoning in `src/lib/comms-draft.server.ts` citing observed facts and human decisions only. |
| Approval before external send | **Exists** | Review states `draft → needs_human_review → approved → sent`; blocking violations prevent approval; Comms structurally cannot send (`gmail.readonly` only; no send path in code). |
| Learning from Tai's edits to drafts | **Missing** | The only draft mutation is review-state change (`comms-service.ts` "That draft could not be updated"); no diff capture, no voice calibration feedback, no append-only record of what Tai changed. Interaction edits have provenance; draft edits have none. |
| Provenance — why Comms recommends a follow-up | **Exists** | `reasonsToReconnect` returns `ReasonCode` + `reasonText` + `EvidenceRef[]` per reason; `nextRelationshipMove` carries evidence; handoff memory items keep their evidence lanes. An empty reason list is a valid answer by design. |

## Architectural gaps to close before any UI redesign

Smallest set, in dependency order:

1. **The synced-mail seam ends at the database.** `comms_messages` and
   `comms_threads` are written by sync and read by no one. One read path —
   folding synced messages into `conversationTimeline` with their existing
   provenance — closes capabilities c and d together. No new tables, no new
   UI concepts: the thread simply becomes complete.
2. **Sent verification.** A draft marked sent is a claim; the actual sent
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
6. **Schema-state drift in the docs.** `docs/comms-v1.md` says the
   integrations schema "has not been applied" while the Phase-1 sync code that
   depends on it is live. Confirm the applied state in the backend and correct
   the doc so future audits can trust it.

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
