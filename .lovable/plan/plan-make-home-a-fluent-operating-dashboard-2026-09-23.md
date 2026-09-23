# Plan: Make Home a fluent operating dashboard

## Current state confirmed

- Home renders the personal dashboard through `PersonalDashboard`, which passes only goal confirm, task complete, and activity undo into `PersonDashboard`.
- The dashboard task card is currently a readout: it lists open tasks, filters completed tasks out, and has no create or assign control on Home.
- The full Steward Tasks surface already has reusable task creation, reassignment, filters, task detail, and agent-assignment pieces.
- Manual task storage is available in the live backend. A read-only check returned 200 for `steward_tasks` and `steward_task_state`.
- The current completion row always renders an unchecked checkbox in the dashboard list. Completed rows are removed from the open list after refresh, so the page does not give immediate checked-and-crossed feedback.
- The activity feed is labelled “AI teammate activity”, but the dashboard read currently maps the person’s recent activity stream and the UI does not filter the visible list to agent-authored work only.

## Ten product options

1. **Quick Add on Home**
   - Add a compact “New task” button and drawer to the current dashboard.
   - Keeps the mockup mostly intact, but assignment and activity remain split.

2. **Task Command Bar**
   - Add a single command row above My tasks: create, assign, delegate to AI, filter.
   - Fast for power users, but less familiar for a broad team.

3. **Inbox-style Work Queue**
   - Convert My tasks into a dense queue with create, owner chips, due dates, and inline actions.
   - Familiar and scalable, but risks making Home feel like another task app.

4. **Three-lane Board**
   - Show “Mine”, “Team”, and “AI” lanes with drag/drop movement.
   - Visual and modern, but too much layout weight for the weekly Home view.

5. **Today-first Action Strip**
   - Keep the dashboard as a weekly view, then add a focused top strip for “Add”, “Assign”, “Hand to AI”, and “Complete”.
   - Good for speed, but task detail still lives elsewhere.

6. **Conversation-like Task Composer**
   - Let a person type a task in natural language, then Steward extracts owner, date, and acceptance criteria.
   - Strong Trust Tai magic, but it needs AI generation boundaries and could delay the core fix.

7. **Unified Work Panel**
   - Merge My tasks and AI teammate activity into one “Work this week” panel with tabs for Mine, Team, AI, Done.
   - Strong 360 feel, but harder to preserve the approved mockup structure.

8. **Modern Task Card with Inline Controls**
   - Keep the current page shape, but upgrade My tasks into a full mini task surface: create button, owner/agent assignment, done state, crossed completed rows, pagination, and an honest AI activity panel.
   - Familiar, direct, and fits the existing code and schema.

9. **Asana-style Embedded Tasks**
   - Connect Asana and use it as the source for tasks.
   - Familiar to teams already on Asana, but it would add connector setup and conflict with the existing Steward task model unless chosen deliberately.

10. **Agent-first Operating Console**
    - Put AI agents at the centre: what they are doing, what they need, what they completed.
    - Distinctive, but not familiar enough for all teams and too agent-heavy for Home.

## Recommended option

**Build option 8: Modern Task Card with Inline Controls.**

Why this will stand the test of time:

- It uses the familiar task-list model every team understands.
- It keeps Home as the weekly operating view rather than turning it into a separate project manager.
- It reuses the existing Steward creation, assignment, permission, and storage paths instead of creating a second task system.
- It respects Trust Tai’s law: small input, deep intelligence, clear output.
- It cleanly separates human tasks from AI-reported work, so the page does not claim an agent completed something it did not.

## What will change

1. **Create tasks on Home**
   - Add a clear “New task” action in the My tasks card.
   - Reuse the existing task drawer.
   - Save to the existing `steward_tasks` store.
   - Show an honest unavailable state if the store cannot be read or written.

2. **Assign tasks from Home**
   - Add an owner/agent control per eligible task.
   - Reuse the existing reassignment picker and agent capability review.
   - Keep role checks: owner/admin can reassign where authority allows.
   - Extend the authority model so manual tasks created in Steward can be reassigned safely, while Projects and Paperclip-owned work remain owned by their source rooms.

3. **Fix completion feedback**
   - When a task is completed, immediately show a checked icon, crossed title, “Complete” state, and disable repeat completion.
   - Keep completed rows visible briefly in a “Done” section or filter so the user sees the action landed.
   - Prevent duplicate client-side complete actions while the mutation is pending.
   - Preserve server-side refusal for already-complete tasks.

4. **Make AI activity honest**
   - Rename or split the current feed so non-agent events do not appear as AI-completed tasks.
   - Show only agent-authored, reversible, or Paperclip-reported items in “AI teammate activity”.
   - Move ordinary history into neutral copy such as “Recent activity” only if it stays in the same panel.
   - Keep Undo only for reversible agent-clear records.

5. **Keep pagination**
   - Keep bounded pagination for tasks and activity.
   - Paginate after filtering.
   - Preserve stable newest-first activity ordering and deterministic task order.

6. **Keep the approved visual direction**
   - Preserve the pale blue canvas, white cards, compact header, rounded cards, royal actions, and restrained density from the latest mockup.
   - Add controls without turning the page into a heavy admin table.

## End-to-end acceptance criteria

### Task creation

- AC1. A signed-in active workspace member can create a task from Home with title, owner, due date, client/project context, priority, notes, subtasks, acceptance criteria, and links where supplied.
- AC2. The created task saves to the existing Steward task store and appears in My tasks without a page reload.
- AC3. Reloading Home shows the same task from durable storage.
- AC4. If task storage is unavailable, the page says tasks cannot be saved right now and does not fake success.
- AC5. Empty titles are refused before any write.

### Assignment

- AC6. A task can be assigned to the current person, another known team member, or an eligible AI teammate from Home.
- AC7. Team-member assignment updates the existing owner fields and refreshes the dashboard.
- AC8. AI assignment shows the agent’s capabilities and boundaries before assignment.
- AC9. Projects-owned work cannot be reassigned from Home; the user is pointed to Projects.
- AC10. Paperclip-owned agent work cannot be marked complete or reassigned as if Steward owns it.

### Completion

- AC11. Completing an eligible open task records completion once.
- AC12. The completed task immediately shows a checked mark, crossed title, and Complete state.
- AC13. The same visible task cannot be completed twice while the first request is pending.
- AC14. A fresh read of an already complete task keeps the complete state and does not offer the same complete action.
- AC15. Ineligible tasks show the owning-room reason instead of a misleading checkbox.

### AI activity and proof

- AC16. “AI teammate activity” shows only agent-authored, agent-clear, or Paperclip-reported records.
- AC17. Non-agent events no longer appear as tasks completed by a personal AI agent.
- AC18. Undo appears only on reversible agent-clear records and records a compensating event, never deleting history.
- AC19. Weekly cleared counts count only valid, not-undone agent-clear events.
- AC20. Empty AI activity states say nothing has been cleared yet, not zero unless the source was read.

### Experience and visual quality

- AC21. The Home dashboard still matches the approved white-card mockup at 375, 768, and 1440 widths.
- AC22. First useful work remains visible at 1440 by 900.
- AC23. Keyboard focus is visible on create, assign, complete, pagination, and drawer controls.
- AC24. Status is not color-only: every state has text or an icon plus text.
- AC25. No text overlaps or overflows at mobile widths.

### Data, permission, and safety

- AC26. All reads and writes remain scoped to the active organization.
- AC27. No anonymous, inactive, or wrong-workspace user can read or mutate tasks.
- AC28. No new top-level app, parallel CRM, approval queue, or duplicate task store is introduced.
- AC29. No send, outreach, publishing, payment, schema application, or production schedule change happens.
- AC30. If any new SQL is needed, it is proposed only for review and not applied here.

### Tests and verification

- AC31. Unit tests cover task creation payload mapping, empty-title refusal, manual-task reassignment authority, wrong-owner refusal, already-complete refusal, and ineligible owned-room completion.
- AC32. Component tests cover create, assign, complete once, checked/crossed complete display, pagination after filtering, and honest AI activity filtering.
- AC33. Existing placement tests still prove Home is the personal dashboard and the logo opens the welcome overview.
- AC34. Full regression tests pass.
- AC35. Type checking passes.
- AC36. Preview build reports OK.
- AC37. Signed-in browser verification is recorded separately when a real session is available; if unavailable, it stays blocked rather than fabricated.

## Technical approach

- Promote existing `CreateTaskDrawer` and `ReassignPicker` into the Home dashboard path through props on `PersonDashboard` and `MyTasksPanel`.
- Add per-task pending state so completion actions are disabled until the write resolves.
- Add completed-row rendering to the dashboard task panel instead of filtering completed rows out completely.
- Update the authority rules for Steward-owned manual tasks only, while leaving Projects and Paperclip boundaries intact.
- Filter or split dashboard activity by `actorIsAgent`, reversible flags, and Paperclip/agent event provenance.
- Reuse existing pagination helpers.
- Keep all styling on existing semantic tokens and Trust Tai components.

## What will not be touched

- No database schema will be applied.
- No external sends, outreach, publishing, payments, live mailbox expansion, or production schedule activation.
- No new CRM, task database, or approval system.
- No service-role impersonation for signed-in proof.
- No changes to Comms C01-C22, existing Scout People persistence, or client resource migrations.
