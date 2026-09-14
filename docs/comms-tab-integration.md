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
| T03 | Drafts & Reviews: one page, real list, resume after reload, versions, findings, one role-checked approval; standalone intake for Message/Email/Proposal | Implemented in code — one list with a focused pane, structured proposal sections wired through storage and rehydrated on resume; the two columns they need are proposed, not applied, so kind and structure read as "not recorded" live |
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

## Slice 2 — one workspace, real records, honest counts (code evidence)

Date: 2026-09-14. No publish, no client send, no SQL applied.

### What changed

- **Exact record selection.** Dashboard draft rows link with `?draft=<id>`
  (`draftSearch`, `src/domain/comms-section-state.ts`). `/modules/comms/drafts`
  validates `draft`, `session`, `filter`, `new` and restores the same record on
  reload. The workspace binds the draft server-side before a review is opened;
  a draft outside the caller's workspace never binds.
- **One surface, not a stack.** `DraftQueue` and `ReviewWorkspace` are no longer
  stacked under a page header. `src/components/tt/comms/drafts-workspace.tsx`
  is a single list with selection plus one focused pane (draft, review, or new
  intake). `/modules/comms/review?session=…` now redirects into that pane, so
  every old deep link lands on the same record.
- **Overdue follow-ups are actionable.** `src/domain/comms-work-board.ts` puts
  overdue follow-ups and commitments in the past-due bucket, and keeps past
  meetings in a separate "needs a record" bucket — a past meeting is never
  called unfulfilled without completion evidence. `now` is recomputed each
  minute, so a row crosses the boundary without a reload.
- **A failed read never looks empty.** `sectionState` returns
  error/loading/empty/list; a failed section shows a sanitized sentence and a
  retry, and renders no rows and no count. Tests:
  `src/domain/comms-section-state.test.ts`.
- **Counts are the real ones.** Sections show the exact total and, when the
  list is cut, "showing X of N" (`showingNote`), and the view-all link carries
  the matching filter.
- **Separate cache keys.** The dashboard's narrow draft summary uses its own
  query key, so it can no longer poison the workspace queue cache.
- **Kind is persisted, or honestly not.** `src/domain/comms-draft-kind.ts`
  validates `message|email|proposal`; the server writes it and falls back on
  `42703`, returning `kindPersisted: false` so the screen says the kind was not
  recorded rather than implying it was. Tests:
  `src/domain/comms-draft-kind.test.ts` and the two boundary cases in
  `src/lib/comms-review.server.test.ts`.
- **Proposals are structured, and the structure is stored.**
  `src/domain/comms-proposal.ts` holds scope, deliverables, pricing,
  assumptions and next steps with exact minor-unit arithmetic, unknown ≠ zero
  and deterministic rendering. `src/domain/comms-proposal-source.ts` validates
  the sections (currency, numbers, shape, size), stamps a schema version and
  carries the canonical rendered text with them; the server renders the text
  from the validated sections rather than trusting the browser's body, and
  stores both on the version. On read, sections are only honoured when the
  schema version matches and the stored text still agrees with them —
  otherwise the version says the structure was not recorded, never a guess.
  Resuming a proposal rehydrates the composer; "Edit as plain text" converts
  explicitly and from then on the words are the record.
- **A missing column is named, not assumed.** The server retries without
  `structured_source` (or `kind`) only when Postgres says that exact column is
  missing (42703 / PGRST204, message and details); any other missing column is
  a real fault and surfaces. The screen says which of kind and structure was
  not recorded, and never claims "everything else stored".
- **Truthful record states.** `rowsFrom` derives state from the record: a
  closed review is "Closed", not "In review", and a closed review no longer
  hides a draft still waiting at the boundary. Counts are hidden while a read
  is loading or failed, and a capped list says so.
- **One record per selection.** A `?draft=` link whose draft has a live review
  is corrected to that review in the address; a draft the capped list does not
  hold is fetched by name within the workspace, with distinct loading,
  not-found and no-access states.
- **No quiet re-park after a failed send.** A send failure no longer flips the
  draft back to "needs human review" — the send record is the authority and an
  unknown outcome stays reconciliation, with no implicit retry.
- **Dirty edits are protected** on tab, back, record and new-kind navigation
  through a router blocker plus the browser unload prompt, covering both the
  intake and the review editor. An untouched proposal's empty headings do not
  count as writing.

### Outcome status

- **T01 — five destinations, each doing real work.** Implemented in code;
  routes `/modules/comms`, `/modules/comms/drafts`, `/modules/comms/relationships`
  return 200 locally and old links redirect. **Not live-verified** (no signed-in
  session available here).
- **T03 — draft kind and proposal structure carried end to end.** Wired through
  the API, create, new version, read and composer rehydration, with a truthful
  fallback. Live-unverified, and neither `kind` nor `structured_source` exists
  in the applied schema yet, so today the screen reports them as not recorded.


### Proposed SQL (not applied)

`docs/migrations/proposed/20260914220000_comms_review_kind.sql` — additive
only: `comms_review_sessions.kind` with a three-value check, and
`comms_review_versions.structured_source` for the proposal structure the text
was rendered from. Existing grants, policies and triggers are untouched. For
Codex review; the app works without it.

### Blockers (unchanged and honest)

- **AI review is not functional.** The only live run
  (`b7bee2e2-4b13-476e-9f61-af008d374215`) failed with `provider_call_failed`
  and persisted no provider, model or status, so the cause is still unknown.
  Sanitized diagnostics exist in code but are not deployed.
- **Hosted deployment is behind Git**; nothing in this slice is live.
- No send path has been exercised; suite approval → send integration remains
  explicitly unmet.
