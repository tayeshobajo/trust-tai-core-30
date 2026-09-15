# Comms — the eight-round pack

Tai authorised running the eight rounds in sequence. This file carries the
shared instructions once, then one section per round.

## Shared instructions (apply to every round)

- Project `65944e34-ede5-4757-befb-870e1ff97444`, repository
  `tayeshobajo/trust-tai-core-30`, existing external Supabase project
  `okydosoacqdnursmmenf`. Lovable Cloud is never enabled here.
- Preserve the approved `/mockups/comms-workspace-v2` direction and the five
  destinations: Dashboard, Conversations, Drafts & Reviews, Voice DNA,
  Connections, with New draft (Message / Email / Proposal) always visible.
- Preserve the OS typography and visual language. The marketing site's design
  system is not substituted.
- `docs/comms-tab-integration.md` (T01–T05), `docs/comms-review-progress.md`
  and `docs/comms-review-acceptance.md` (C01–C22) keep their canonical
  definitions. Evidence is added against them; no ID is redefined to make a
  feature pass.
- Preserve record IDs, history, organisation boundaries, real author /
  reviewer / sending identity, immutable versions, source provenance, context
  revisions, one approval authority and idempotent delivery. Reuse existing
  services: no second queue, second store or parallel draft model.
- Migrations for review, delivery and kind/structured-source are already
  applied. Inspect actual migration history before proposing anything further;
  new SQL goes to Codex for review, is never applied here, and applied files
  are never reapplied or reset.
- No production publish and no message sent during these eight rounds.
  Preview preparation and synthetic no-send QA are allowed. Real client threads
  and the workspace's Voice DNA are not altered to produce evidence.
- Historical evidence preserved untouched: QA review session
  `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f`, run
  `b7bee2e2-4b13-476e-9f61-af008d374215`.
- Evidence labels: **Implemented**, **Code-tested**, **Live-verified**,
  **Tai-accepted**, **Blocked**, **Not applicable with reason**. A blocked,
  skipped or mocked check is never reported as a pass.

## Round 1 — Finish Conversations and lock the workspace

Date 2026-09-15. Environment: Lovable sandbox, dev server on localhost, no
signed-in session (`LOVABLE_BROWSER_AUTH_STATUS=no_supabase`). Nothing
published, nothing sent, no schema change proposed or applied.

### Outcome

Conversations is now the working room the approved direction described: a
compact header with the five tabs, the list of people, and one focused pane
holding the latest exchange, the editable goal, the reply editor and the
primary action. Earlier history is real records one click away. Failed reads
are visible as unavailable rather than a quiet thread. Unsaved writing is
protected with a real choice, and a narrow screen opens one conversation at a
time with a way back.

### Changed files

| File | Change |
| --- | --- |
| `src/components/tt/comms/conversation-room.tsx` | `historyGaps` / `onRetryHistory` notice above the thread; `onBack` control for narrow screens; the "nothing on record" line is suppressed whenever a read failed. |
| `src/routes/modules.comms.relationships.tsx` | Per-read gap derivation from the touches / messages / drafts queries; retry refetches all three; person switching goes through `openRelationship`, which asks before discarding unsent writing; `useBlocker({ withResolver: true })` with an in-room Stay / Discard dialog replacing `window.confirm`; mobile pane state for list-or-room. |
| `src/components/tt/comms/conversation-room.test.tsx` | New: four focused checks (added this round). |
| `docs/comms-eight-rounds-progress.md` | This file. |

No service, schema, identity, approval or delivery code was touched. No change
outside Comms.

### Acceptance

| ID | Evidence | Detail |
| --- | --- | --- |
| P1.1 | **Implemented** · live **Blocked** | No hero. Header row + tabs ≈ 110px, then list and room at `calc(100dvh-190px)`, so at 1440×900 the latest exchange, goal row, reply editor and "Review this draft" sit inside the viewport. Measurement in the signed-in app is blocked. |
| P1.2 | **Implemented** (pre-existing, re-checked) | Search, tab and health filters derive over the whole accessible set (`inboxView`), paging renders only; `?relationship=<id>` seeds the selection and `/modules/comms/conversations` redirects preserving it. Not live-verified. |
| P1.3 | **Code-tested** | `conversation-room.test.tsx`: a failed read renders "Part of this history could not be read" with the source and message and **no** empty-thread line; an all-succeeded empty thread still says so. Earlier days stay reachable behind a real count and appear on click. |
| P1.4 | **Implemented** · live **Blocked** | Save → "Review this draft" calls the existing `openReview(draftId, organizationId)` and navigates to `/modules/comms/drafts?session=…`; the drafts workspace resolves the exact record (covered by `drafts-workspace.test.tsx`). One review, one approval, authorship untouched. Round-trip against persisted records is blocked. |
| P1.5 | **Implemented**, partly **Code-tested** | Tab, person, record and browser-back departures with unsent writing open a Stay / Discard dialog; reload is covered by `enableBeforeUnload`. Save is **Not applicable with reason**: reply text becomes a record only by preparing a draft (a model call), so the dialog says plainly that the text is not saved yet instead of offering a save that does not exist. A failed prepare keeps the text in the editor. |
| P1.6 | **Implemented** (pre-existing, re-checked) | Close/reopen writes through `setConversationClosed`; follow-up settle/remind/not-needed go through the existing relationship mutations; Scout and Roadmap handoffs keep their existing identity and readiness gate. Not live-verified. |
| P1.7 | **Implemented** · live **Blocked** | Under `lg`, list and room are alternate panes; selecting a person opens the room, "← All people" returns. The back control is covered by a focused test; the responsive behaviour itself is CSS and needs a device check. |

### Tests

`bunx vitest run src/components/tt/comms/conversation-room.test.tsx
src/components/tt/comms/drafts-workspace.test.tsx` — 2 files, 9 tests, passing
(2026-09-15). `bunx tsgo --noEmit` clean; build OK.

### Screenshots

None added this round. The only production screen this environment can reach
is the signed-out gate (`/tmp/browser/t02/prod-signedout-desktop.png`), and a
fixture screenshot would not be evidence for a production acceptance row.

### Unresolved

1. **No signed-in environment.** Every row marked live is blocked. Impact: P1.1,
   P1.2, P1.4, P1.6, P1.7 have code evidence only.
2. **AI review has never succeeded.** Unchanged from
   `docs/comms-release-readiness.md`; not touched this round.

### Exact next action

Round 2 must supply the signed-in preview: confirm
`https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app` serves
this build, sign in there, and close P1.1, P1.2, P1.4, P1.6 and P1.7 against
persisted records with desktop and mobile captures. No send.
