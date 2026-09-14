# Comms tab integration — capability map and acceptance evidence

Scope: make every Comms destination function and serve a purpose, on the existing
records, services and authority. No new backend, no schema applied, no publishing,
no client sends. The isolated mockup at `/mockups/comms-workspace-v2` stays for
reference and is not wired into production.

This document **extends** the original C01–C22 contract in
`docs/comms-review-progress.md`. Those IDs and their wording are unchanged. New
outcomes are numbered T01–T05 (one per tab) and are additive.

## Agreed navigation

Five destinations plus a persistent **New draft** action (Message / Email / Proposal).
The previous ten destinations are not restored; the retired ones remain reachable
from inside the work they belong to, and all old links still resolve.

| Tab | Route | Backed by |
| --- | --- | --- |
| Dashboard | `/modules/comms` | `commsService.list` → `buildPlan` (`src/domain/comms-plan.ts`), `comms_drafts` (`review_state = needs_human_review`), `listReviews` (`/api/public/comms/review`) |
| Conversations | `/modules/comms/relationships` | existing relationship room: `comms_relationships`, `comms_messages`, Gmail sync, composer, Save to Scout |
| Drafts & Reviews | `/modules/comms/drafts` | `DraftQueue` (moved from the Queue page, unchanged behaviour) + `ReviewWorkspace` (review sessions, versions, runs, findings, coverage, approval) |
| Voice DNA | `/modules/comms/voice` | existing voice profile service (`src/data/supabase/comms-voice.ts`) |
| Connections | `/modules/comms/integrations` | existing integrations panel, Gmail connection, provider status |

### Compatible routes (old deep links preserved)

| Old link | Now |
| --- | --- |
| `/modules/comms` (was Relationships) | Dashboard; the relationship room moved to `/modules/comms/relationships` |
| `/modules/comms/dashboard` | 307 → `/modules/comms/conversations` (same conversation list, unchanged) |
| `/modules/comms/queue` | 307 → `/modules/comms/drafts` |
| `/modules/comms/review?session=…` | unchanged; renders under the Drafts & Reviews tab |
| `/modules/comms/plan`, `/modules/comms/inbox`, `/modules/comms/to-scout` | unchanged routes, off the tab bar, linked contextually |

## Capability → existing service / record

| Capability | Existing service | Record |
| --- | --- | --- |
| Replies owed, promises, follow-ups | `buildPlan` / `planItemsFor` | `comms_relationships` (`response_due_at`, `follow_up_due_at`, commitments in metadata) |
| Drafts held for a human | `comms_drafts` read + `/api/public/comms/review` `action: bind` | `comms_drafts`, `comms_review_sessions` |
| Review, versions, findings, coverage, approval | `src/lib/comms-review.server.ts` | the seven `comms_review_*` tables (migration `comms_review_runs_hardened`) |
| Send readiness and dispatch | `src/lib/comms-send-authority.server.ts`, `/api/public/comms/send` | `comms_review_approvals`, `comms_delivery_attempts` (migration `comms_review_delivery_hardened`) |
| Voice profile and version | `src/data/supabase/comms-voice.ts`, `loadVoicePacket` | `comms_voice_profiles` |
| Connection state | `src/components/tt/comms/integrations-panel.tsx`, `gmail-connection.tsx` | `comms_integrations` |

Preserved unchanged by this work: membership rules, immutable versions, context
revisions, provenance, the idempotent dispatch gate, and the retired legacy edge
function (still 410).

## Outcome contract (extends C01–C22)

| ID | Outcome | Status |
| --- | --- | --- |
| T01 | Dashboard answers "what needs action and why" from real scoped records; each item opens the exact destination; no invented deadlines; silence alone is not risk | Implemented (code-tested); live-verified pending |
| T02 | Conversations: real threads, goal, draft, review the same draft, person memory, Save to Scout, honest sources | Preserved from existing room; consolidation into one surface not yet done |
| T03 | Drafts & Reviews: one page, real list, resume after reload, versions, findings, one role-checked approval; standalone intake for Message/Email/Proposal | Partly implemented — queue + review on one page and the kind is carried into intake; structured proposal sections (scope/deliverables/pricing/assumptions/next steps with arithmetic checks) **not built** |
| T04 | Voice DNA: stored profile, authorized editing, version history, applied version shown in review, saved changes clear readiness | Existing behaviour preserved; history/reconstruction review not yet audited |
| T05 | Connections: real account/channel/sending identity, separate facts for connection health, AI availability and send readiness; no secrets shown | Existing behaviour preserved; separation of the three facts not yet audited |

## Acceptance evidence, slice 1 (navigation + Dashboard)

Distinguished as required.

- **Implemented**: five-tab navigation with persistent New draft menu; Dashboard
  built from real records; Drafts & Reviews page combining the queue and review
  workspace; compatible redirects.
- **Code-tested**: `bunx tsgo --noEmit` clean; build OK; every route answers —
  `/modules/comms` 200, `/modules/comms/drafts` 200,
  `/modules/comms/relationships` 200, `/modules/comms/conversations` 200,
  `/modules/comms/queue` 307, `/modules/comms/dashboard` 307.
- **Live-verified**: none in this slice. The sandbox has no signed-in session for
  the external workspace, so no dashboard count has yet been read against live
  rows.
- **Blocked**: live AI review remains unproven. Review run
  `b7bee2e2-4b13-476e-9f61-af008d374215` in session
  `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f` failed with `provider_call_failed`; that
  QA record is preserved untouched and AI is not described as functional.

## Next slice

Drafts & Reviews as a single working surface: carry the chosen kind into the
intake as a real field, structured proposal sections with arithmetic and
consistency checks (schema change proposed for review, not provisioned), real
list filters, and resume-after-reload verified against persisted records.
