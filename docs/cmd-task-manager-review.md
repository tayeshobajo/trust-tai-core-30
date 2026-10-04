# CMD task manager: staged review

Status: staged only, not delivered or deployed. No production records, policies or schema changed.

## Baseline and existing capabilities

Reviewed repository `tayeshobajo/trust-tai-core-30`, baseline `334a766e9afd655b08ad8ebf1f381aeb9688beb5`, also reported as latest by Lovable project `65944e34-ede5-4757-befb-870e1ff97444` during inspection. Read root AGENTS.md. Preserve published history.

Canonical list: `/modules/steward/tasks`. Existing `steward_tasks` stores manual tasks; commitments, Projects and Paperclip remain their respective sources of truth. Home already links to this list through PersonalDashboard. Existing create/update, assignment, due dates, status, context links, criteria and completion overlay must be reused. No parallel task database is needed.

The live external database is `okydosoacqdnursmmenf`. Lovable Cloud database is disabled; do not provision it. Read-only inspection confirmed the manual task columns match the repository including source_app, source_entity_type, source_entity_id and correlation_id.

## Staged code

Manual task projection now preserves existing subtasks, criteria, notes and context links. Task details render the first unchecked recorded subtask as next action, explicitly typed dependency links, notes, planned acceptance criteria and source links. Missing information is labelled as unrecorded. Source links are not described as checked completion receipts. Only http/https links are clickable. Additional context is currently restricted to the verified task owner pending the shared business access decision; this is a presentation guard, not database security.

No new writes, state transitions, deletion controls, goal changes, historical Home redesign or PORTAL code are included. This is preparatory context rendering, not the complete requested operational board.

## Minimal separation proposal — pending approval

1. Keep personal dashboard self detail and teammate status-only views. Do not reinterpret every canonical project task as private.
2. Reuse steward_tasks for the approved business set, with reserved source_app `cmd-business`, source_entity_type `operational_task` and stable correlation_id values. Never infer classification from title or auto-classify historical rows.
3. Keep next actions in existing subtasks, explicit dependencies in context_links with kind `dependency`, planned checks in acceptance_criteria, and recorded blocker context in notes. Completion remains an explicit checked result with durable receipt. This avoids duplicating delivery truth or adding a new table.
4. Decide exactly which members can read business titles/details and which can edit status, assignments and completion. Provenance fields are editable today, so classification alone cannot enforce security.
5. If genuine private task storage is required, server-controlled classification and separate aggregate reads are necessary. Draft the exact migration after the access decision; do not change org-wide Projects/commitments access indiscriminately.

## Verified security gaps and affected paths

Live pg_policies inspection: steward_tasks and steward_weekly_goals permit authenticated organization members SELECT, INSERT, UPDATE and DELETE using private.is_org_member(organization_id). steward_task_state has the same member predicate. This is existing behavior, not a newly introduced grant.

`src/routes/modules.steward.people.$userId.tsx` passes team scope to PersonDashboard, hiding titles and actions visually. However `readStewardDashboard` calls `readStewardTeam`, fetching detailed tasks before filtering. UI scope does not prevent database/network access. A strict personal privacy contract requires a scoped server read or RLS plus a status aggregate endpoint, with activity/task-state text assessed as well. Existing shared project collaboration must remain intact.

`weeklyGoals.confirm(id)` in `src/data/supabase/weekly-goals.ts` updates by ID without owner or proposed-status predicates; live member UPDATE policy permits confirmation of another person's goal. Relevant callers include Home PersonalDashboard and Steward Tasks; teammate UI disables confirmation but does not enforce server ownership. Proposed narrow correction: authenticated owner-only confirmation, proposed-to-confirmed transition check, immutable owner/org on that operation, and server-side protection against arbitrary direct UPDATE/INSERT of confirmed goals. Verify effect on proposal/reconcile producers before migration. Do not apply policy changes yet.

`completeAuthority` permits admins to complete another person's Steward-owned work. This may be valid collaboration; do not remove it without an access decision. Existing completion allows an empty note, and task-state receipt failure is swallowed after status succeeds. A strict checked-result contract needs durable evidence validated before completion, including failure/retry tests; the staged rendering does not claim to fix it.

Existing DELETE policies allow irreversible removal. No delete UI was added. Recoverable archive semantics require an explicit persisted representation and enforcement decision; do not silently reinterpret draft as archived.

## Publication gate

Await parent decision on shared business access and approval of any exact policy/schema correction. Sanitized business records remain a preparation list, not seeded data. Then finish CRUD/state transitions, durable checked completion, recovery, access tests, refresh persistence, empty/loading/error tests, keyboard/mobile checks and authenticated live QA. Reconfirm exact remote head and CI, no concurrent publisher, then publish through Lovable and verify actual live desktop/mobile behavior. A commit or publish badge is insufficient.

Shell GitHub read failed with DNS resolution in the restricted environment; GitHub connector remains a possible route. No push attempted. No production fixture records, external messages or scheduled sends were created.
