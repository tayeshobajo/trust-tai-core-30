# Steward: real Fathom meetings in the approved 3-column view

Base revision: `cc416ecc80fd9e7330dcfcc3a3fcb91a10b35729` (clean tree). Inspection was read-only.

## What exists today (verified by reading the code)

- **Fathom adapter (server only):** `src/lib/steward-fathom.server.ts`. It reads `FATHOM_API_KEY` (present in this environment) and calls `https://api.fathom.ai/external/v1`. It maps `transcript[]` into `TranscriptSegment { index, speaker, speakerEmail?, at "HH:MM:SS", text, url }`, and `calendar_invitees` into participants. Errors are typed: `SourceUnavailableError` and `SourceNotFoundError`.
- **Endpoint:** `src/routes/api/public/steward.conversation.ts`. Each request needs a bearer token plus an active `organization_memberships` row.
  - GET returns the source status plus 8 recent calls, as metadata only.
  - POST reads one call by link and returns `{ conversation, proposals }`. It writes nothing.
  - One gap: the Fathom key belongs to the whole workspace, so any active member can list and read any call that key can see. The handler does not filter calls per user.
- **Stored meetings:** `public.conversations`, read through `stewardService.conversations()` in `src/data/supabase/steward-service.ts`. Fields: `id, organization_id, title, occurred_at, created_at, source_provider, source_url, participants, transcript` (the full normalized conversation as JSON).
  - Access rules (`docs/steward-v1-schema.sql`): members can SELECT, INSERT and UPDATE. There is no rule that limits a transcript to its owner or to attendees.
- **Promises:** `public.commitments`, read through `stewardService.commitments()`. Fields: `owner_name/email/user_id, statement, due_at, due_text, status, conversation_id, project_id, decision_id, source_key, evidence[]`.
- **Tasks:** `steward_tasks`, read through `src/data/supabase/steward-tasks.ts` and `cmd-tasks.ts`. `buildStewardTasks` in `src/data/steward/accountability.ts` merges them with commitments, project work, agents and task state. The shared reader is `readStewardTeam` (`src/data/steward/team-read.ts`).
- **Completion and approval:** commitments only become real when a person confirms them in `ProposalReview` / `SemanticReview` on `/modules/steward/meetings/$conversationId`. Task edits are gated by `mayEditBoardTask`.
- **Existing meeting pages:** `modules.steward.meetings.index.tsx`, `.$conversationId.tsx` and `.actions.tsx`. All of them sit behind `WorkspaceGate` inside `AppShell`.

## What is verified and what is only inferred

| Field | Where it comes from | Status |
|---|---|---|
| Title, date, participants, segment timestamps | Fathom payload | Taken from the source |
| Transcript coverage | Number of segments plus the last `at` value, compared with the call length | Partly known: the adapter does not store call length, so we cannot say the transcript is complete |
| Owner | `owner_user_id` after a person confirms; otherwise `owner_name` taken from speech | Verified only when `owner_user_id` is set |
| Due date | `due_at` (an exact date) vs `due_text` (what someone said) | Exact only when `due_at` is set |
| Status | `commitments.status` / task state | A person set it, but it is not proof of completion |
| Evidence | `evidence[]` contains quote and segment references | Proof of the source, not proof of completion |
| Task ↔ meeting link | `commitments.conversation_id` and `source_key` | Linked by id. `steward_tasks` has no conversation link except through `correlation_id` |

## Specific stored recording: not identified (blocked)

The sandbox has no signed-in member session (`LOVABLE_BROWSER_AUTH_STATUS=no_supabase`). That means:
- I could not read `conversations` under normal member access.
- I did not use the admin key or the Fathom key, because either one would bypass ownership.

I am not reporting any record title, id or coverage. The only call id found in the repository is the rehearsal reference `779145597` in `scripts/steward-semantic-acceptance.ts`, and it is not confirmed as stored. Next step: Tai's executor signs in, opens `/modules/steward/meetings` and reports the stored call's id, title, segment count and first/last timestamps from the page. No transcript text should go into logs.

## Missing backend pieces (no new permissions needed for steps 1–3)

1. **Meeting progress read:** one shared reader that returns, per conversation, its confirmed commitments, linked tasks, coverage and score. It would combine the existing `readStewardTeam` data with `conversations`, using member access only.
2. **Transcript coverage field:** store or calculate the call length (Fathom `recording_end_time - recording_start_time`) so "partial coverage" is real.
3. **Completion proof:** completing work needs a non-empty proof. Reuse the existing commitment `evidence` and the task completion path; do not add a new table.
4. **(Needs Tai's decision; changes access) Transcript privacy:** at the moment every active member can read every stored transcript and every call the shared Fathom key can see. Limiting this to attendees would require a database migration and a stricter endpoint. I will not do it without explicit approval.

## Proposed build (after approval)

- New route `/modules/steward/meetings/workroom`, behind `WorkspaceGate`. It reuses the approved 3-column layout pieces (meeting rail, task table, `TaskDetails`) with real data passed in. `/mockups/steward-next` stays fictional and unchanged.
- Data: the meeting progress reader from step 1, with transcript text loaded only for the selected meeting, on demand.
- Truth rules: AI proposals stay out of the score; unknown owner and spoken dates are labeled as such; when the call length is unknown, coverage shows as "not yet known".
- Actions: confirm and complete only through the existing commitment and task paths and their access checks. No automatic import, sending or AI runs.
- Tests: scoring from real-shaped rows, unknown coverage never shows 100, and a member without edit rights cannot complete work.

## Out of scope
New credentials or connections, migrations, re-importing calls, sends, publishing, admin-key reads.
