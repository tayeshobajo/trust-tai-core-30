# Meetings & Actions (draft) — architecture inspection and integration plan

Read-only findings. This turn made no changes to code, data, access settings, publishing or messages.

## What already exists

Meeting routes (all behind `WorkspaceGate appId="steward"`, all `noindex`):
- `src/routes/modules.steward.meetings.tsx`: layout that only renders the Outlet.
- `src/routes/modules.steward.meetings.index.tsx`: picks a source. It reads through `readConversation`, `readSourceState` and `readRehearsal` in `src/data/steward/ingest`. The rehearsal transcript is clearly labelled (`REHEARSAL_NOTICE`, `src/data/steward/fixture`).
- `src/routes/modules.steward.meetings.$conversationId.tsx`: reviews one conversation. It uses `extractProposals` (`src/data/steward/extract`), `interpretConversation`, `SemanticReview` and learning drafts.
- `src/components/tt/steward/proposal-review.tsx` already covers: truth tier, confidence, the exact quote it came from, "no owner named" (owner is never guessed), "said timing is not a date", and confirm-only-with-owner.
- `src/components/tt/steward/recent-meetings.tsx`, `fathom-sync.tsx`, and `src/lib/steward-fathom.server.ts`: the Fathom source.

Tasks (the one task system; don't build a second tracker):
- Table `steward_tasks` via `src/data/supabase/steward-tasks.ts`, plus `cmd-tasks.ts` for the board.
- Columns used: `status`, `source_app`, `source_entity_type`, `source_entity_id`, `correlation_id`, subtasks, `acceptance_criteria`, `context_links`, `notes`, due date.
- There's already an idempotent lookup by `correlation_id`.
- Board statuses and labels are in `src/domain/cmd-tasks.ts`: draft = Proposed, open, in_progress, waiting, blocked (needs a reason), in_review, needs_approval, complete (needs at least 10 characters of evidence).
- `mayEditBoardTask` decides who can edit.
- Completion receipts: `steward_task_state` (`src/data/supabase/steward-task-state.ts`) and the timeline mapping in `src/domain/steward-task-timeline.ts`.

Meeting commitments:
- Table `commitments` via `src/data/supabase/steward-service.ts`. It's upserted on `organization_id,source_key`, and status updates are made by id.
- Table `conversations` stores conversations.

Rules and design:
- Root `AGENTS.md` says to use the workspace skill `trust-tai-brand-system`: warm paper, deep ink, royal blue only as a signal, Cormorant headlines, Inter for interface text, JetBrains Mono for status.
- Project rules: data is shown only after an active membership is verified, never bypass access rules, unknown is not zero, nothing happens on its own.
- `docs/cmd-task-manager-review.md` records known gaps:
  - Members can update and delete any `steward_tasks` row in their workspace.
  - The teammate view fetches task details before hiding them.
  - Weekly-goal confirm checks only the id.
  - Completion can succeed even when the receipt fails to save.

## Privacy constraints

- Do not commit any real meeting content (transcripts, quotes, names, deliverables) as a file, fixture or seed in `src/`. The browser bundle is public.
- There's no protected staging storage today for unconfirmed meeting deliverables. Staging must stay only in the browser session, in memory or `sessionStorage`, cleared when the tab closes. It must never use `localStorage` or `public/`.
- Today teammates can read the tasks table. So no staged item becomes a task until a person explicitly confirms it, and confirming is a separate step outside this draft.

## Safest draft integration (no live writes)

1. New child page `src/routes/modules.steward.meetings.actions.tsx` (`/modules/steward/meetings/actions`), gated with `WorkspaceGate appId="steward"` and `noindex`. It gets a Steward tab, not a new room.
2. Session-only import: the person pastes text or picks a local `.md`, `.txt` or `.json` file. A pure parser in `src/domain/meeting-actions.ts` turns it into staged items held in memory or `sessionStorage`. There are no network writes.
3. Read-only cross-reference: link to existing tasks only by reading `steward_tasks` by `correlation_id` (`meeting:<sourceKey>:<itemHash>`), so duplicates show as "already tracked".
4. Buttons say "Stage only", and the confirm control is disabled with an explanation. Turning confirm on later reuses the existing `stewardTasks` create path (`source_app='steward'`, `source_entity_type='meeting_action'`) after the access decision in the review doc.

## Page structure

```text
Header: Meetings & Actions  [Draft · nothing saved]
Import strip: paste / local file · source timestamp · clear session
Filters: All · Proposed · Confirmed · Blocked · Overdue · Done · Unknown owner
List (white cards), each row:
  status pill (text + icon, never colour alone)
  statement · owner or "Owner not named"
  due: exact date | "said: next week" (uncertain) | none
  next step · depends on (linked rows) · source + timestamp + quote
  Complete: green tick + "Done" + Reopen
Side panel: matching existing task, if any (read-only)
```

Each staged item has: id, kind, statement, proposed or confirmed, owner (or unknown), due date with certainty (exact, said, or none), next step, dependencies, source title and timestamp, quote, status, and the matching task id if one exists.

Overdue applies only when there's an exact due date in the past and the item isn't done. Uncertain dates are never counted as overdue.

## Technical details / tests

- Pure functions with vitest checks:
  - Parsing.
  - Filters: overdue excludes uncertain dates, and blocked requires a reason.
  - Reopen goes back to the previous status.
  - An unknown owner is never filled in.
- A test fails if anything under `src/` contains meeting fixture text beyond a synthetic sample.
- Reuse `MetaPill`, `TTButton`, `tt-surface`, and the `BOARD_STATUS_LABEL` vocabulary.
