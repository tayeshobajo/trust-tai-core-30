# Recent email on the Comms Dashboard

Add a prominent, honest "Recent email" card to the real Comms Dashboard, built only from records that already exist in `comms_messages`. No sends, no publish, no schema changes, no widening of the Gmail label scope.

## What Tai will see

A white card at the top of the Dashboard, above the existing work columns:

- One row per conversation (mailbox + thread), newest first, 10 to begin with.
- Each row shows the person and company, the subject, which mailbox it arrived in, when the last message happened, and who spoke last: "They wrote last" or "You replied".
- A recent incoming email stays visible after a reply is sent. Reading the Dashboard never marks anything read and never changes any conversation.
- Under the list: the declared time window, the true total in that window, "Show more" and "See all".
- A separate line for each mailbox: when it last synced successfully, or that it is stale, errored or unavailable. This is kept apart from "when this page last read the records".
- Clicking a row opens that exact conversation and scrolls to that message.

## How it works

**New pure module `src/domain/comms-recent-email.ts`**
- Groups stored messages into threads keyed by `mailbox + providerThreadId`, falling back to `threadId`, then the message id. Two subjects with the same person stay two rows; the same provider thread id seen in two mailboxes stays two rows.
- Tracks the latest inbound and the latest outgoing separately, so reply state is derived from both and never claims obligations are settled.
- Receipt or unread state produces no "reply owed" of any kind; the existing Replies owed card keeps its own rule untouched.
- Mailbox sync freshness helpers: fresh / stale / error / unavailable, with a declared staleness threshold.

**New read `src/data/comms-recent-email.ts`**
- Org-scoped `comms_messages` read filtered by a declared window (30 days) *before* pagination, `order occurred_at desc`, `range()` paging, and `count: "exact"` for the scoped total. No first-1000 truncation.
- Reuses the existing column-variant fallback so older schemas still read; a missing table or failed read returns an explicit "unavailable" state, never an empty success.
- Reimported duplicates collapse on provider message id.

**Dashboard `src/routes/modules.comms.index.tsx`**
- New `RecentEmail` section in the approved white-card styling, placed above the existing columns, spanning the full width.
- Reads mailbox connections through the existing `listIntegrations` for last successful sync; "Check again" re-reads only and says so. A separate "Sync mailboxes" reuses the existing authorized Connections sync action (`gmailSync`), and only after it completes does the feed claim new mail. Refreshes on window focus too. No secrets displayed.
- Empty state explains that Comms only sees mail labelled `Trust Tai/Comms`.

**Deep link `src/routes/modules.comms.relationships.tsx`**
- Accept optional `thread` and `message` search params alongside `relationship`, and focus/scroll the named message in the conversation room. Read-only: opening does not mark read or touch relationship state.

## Tests

`src/domain/comms-recent-email.test.ts` and `src/data/comms-recent-email.test.ts` with synthetic fixtures only: inbound then reply, two threads for one person, the same thread id across two mailboxes, repeated import, pagination and ordering, wrong-organization rows, partial read failure, timezone handling, and stale sync.

## Documentation

`docs/comms-email-dashboard.md`: changed files, build and test results, EMAIL-D01 to D08 evidence, plus findings on sync cadence, limits, pagination, cursor and label semantics read from the sync code. Authenticated screen and thread verification stays pending with Codex; no fixture screenshot will be described as live, and nothing is claimed complete.
