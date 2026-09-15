# Recent email on the Comms Dashboard

Build: preview build of the existing project, external Supabase `okydosoacqdnursmmenf`.
Scope: presentation and read-only additions. No schema applied, no publish, no send,
no change to the production sync schedule, no widening of the Gmail label scope.

## What was added

A "Recent email" card at the top of the real Comms Dashboard
(`/modules/comms`), built only from rows that already exist in
`comms_messages`. Rendering it performs reads only: it marks nothing read, it
writes to no relationship, and it creates no reply owed.

### Changed files

| File | Change |
| --- | --- |
| `src/domain/comms-recent-email.ts` | New. Pure grouping into mailbox + thread rows, reply state, mailbox sync freshness, window sentence. |
| `src/data/comms-recent-email.ts` | New. Organization-scoped, window-filtered, paged read of `comms_messages` with an exact scoped count and an explicit unavailable error. |
| `src/routes/modules.comms.index.tsx` | New `RecentEmail` section in the approved white-card styling, plus mailbox sync lines and the authorized sync action. |
| `src/routes/modules.comms.relationships.tsx` | Accepts optional `thread` and `message` search params and passes the message to the conversation room. |
| `src/components/tt/comms/conversation-room.tsx` | Optional `focusMessageId`: scrolls to and focuses the named message, revealing earlier history when the message sits there. Read-only. |
| `src/domain/comms-recent-email.test.ts` | New. 12 tests. |
| `src/data/comms-recent-email.test.ts` | New. 5 tests. |

### Verification run

- `bunx tsgo --noEmit` — clean.
- `bunx vitest run src/domain/comms-recent-email.test.ts src/data/comms-recent-email.test.ts` — 17 tests passed.
- Build observability log reports `build OK` for the current preview build.
- All fixtures are synthetic. No real record was read, written, or screenshotted.

## Criterion evidence

| ID | Evidence | Result |
| --- | --- | --- |
| EMAIL-D01 | White `comms-card` section on the real Dashboard route, reading `comms_messages` scoped by `organization_id`. Each row shows person, company when known, subject, mailbox, last activity time and reply state. An inbound message stays in its row after a reply; reply state only describes the last message. No receipt or unread flag feeds "Replies owed", which still derives from the relationship record and is untouched. | PASS-CODE |
| EMAIL-D02 | `threadKeyOf` groups by `mailbox` + `providerThreadId`, falling back to `threadId` and then `message:<id>`. Tests cover two simultaneous subjects for one person and one thread id seen in two mailboxes. `lastInbound` and `lastOutbound` are tracked separately; `REPLY_STATE_NOTE` states explicitly that anything else owed is unchanged. | PASS-CODE |
| EMAIL-D03 | Each row links to `/modules/comms/relationships` with `relationship`, `thread` and `message`. The route validates all three; the conversation room scrolls to and focuses that message and reveals earlier history if needed. No mutation runs on render. | PASS-CODE, live thread verification pending |
| EMAIL-D04 | `listRecentEmail` applies `eq(organization_id)` and `gte(occurred_at, since)` before `order("occurred_at", desc)` and `range(0, limit - 1)`, with `count: "exact"` for the scoped total. Ten rows are shown initially; "Show more" pages the grouped rows and "Read further back" raises the read window size. No first-1000 default is used. The read reuses the existing message store and the existing Gmail label scope; it adds no provider call. | PASS-CODE |
| EMAIL-D05 | Mailbox sync lines come from `listIntegrations` (`last_sync_at`, `status`) and are rendered separately from the page's own "Read at …" line. States: fresh, stale, error, never, disconnected. "Check again" re-reads records only and says so. "Sync mailboxes" calls the existing authorized `gmailSync` action used by Connections. No token, cursor, or vendor id is displayed. | PASS-CODE |
| EMAIL-D06 | The feed re-reads after a sync pass completes and on window focus. Repeated imports collapse on `provider_message_id`. A failed or unprovisioned read raises `RecentEmailUnavailable` and the card says recent email is unavailable, explicitly not an empty inbox. The empty state explains that only Gmail threads labelled `Trust Tai/Comms` are in scope. | PASS-CODE |
| EMAIL-D07 | Tests: inbound then reply, two threads for one person, one thread id across two mailboxes, repeated import, ordering and fallback keys, outbound-only, unnamed person, timezone-correct ordering, stale sync, error mailbox with an older success, fresh mailbox with no secrets, workspace scoping, failed read, missing store, column fallback, exact count and paging. Existing layout, tabs, gates and behaviour are unchanged. | PASS-CODE |
| EMAIL-D08 | This document. | PASS-CODE |

Nothing here is claimed as live. Authenticated screen and thread verification is
open and belongs with Codex against private real records.

## Sync findings, read from the code

Supported by `src/lib/comms-gmail.server.ts` and `src/data/supabase/comms-gmail.ts`:

- **Label semantics.** Ingestion is gated on the exact Gmail label `Trust Tai/Comms`,
  resolved from the mailbox's own label list, never a free-text `label:` search.
  Replies inside an already-approved thread are carried forward by thread id;
  scope never widens by sender or to a new unlabelled conversation.
- **Cadence.** The scheduled pass runs every six hours and uses a deliberately
  overlapping two-day backfill window (`SCHEDULED_BACKFILL_DAYS = 2`). A member
  pass defaults to 30 days, clamped to 1–90.
- **Limits and pagination.** Each pass reads at most `MAX_MESSAGES_PER_PASS = 60`
  labelled messages, paging with Gmail's `pageToken` only while under that bound.
  Approved-thread refresh is bounded at 25 threads per pass with a 300-message
  lookback.
- **Cursor.** The connection row keeps an opaque provider cursor and `last_sync_at`;
  the Dashboard reads only `last_sync_at`, `status` and `last_error`.
- **Lag.** The interval between an email arriving and appearing in Comms cannot on
  its own establish sync lag, because the label may have been applied later than
  the message was received. No lag claim is made here.

The Dashboard's stale threshold is six hours, matching one scheduled cadence
window: a mailbox with no successful pass inside that window reads as stale
rather than silently current.

## Remaining verification

- Authenticated Dashboard screen showing real recent email, and a row opening the
  exact thread and message. Pending, owned by Codex.
- Behaviour against real multi-mailbox records, including a thread visible in two
  connected mailboxes. Pending, owned by Codex.
- Comms is not complete. This work closes recent-email visibility in code only;
  every previously open acceptance row stays exactly as it was.
