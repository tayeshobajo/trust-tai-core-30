# Steward: live walkthrough, AI agent page, task timeline, Scout People context

## Current state (checked)
- The preview has no signed-in session available to me (external backend, status `no_supabase`), so I cannot sign in as you or mint a session.
- The agent run log table (`steward_agent_runs`) and task source-link fields are still a proposed migration, not applied. Live agent runs cannot be recorded durably until Codex applies it.
- The agent runner does not read Scout People today.
- Steward has Team, Meetings, Tasks, Agents, Memory pages; there is no timeline and no dedicated agent queue page.

## 1. Live Home walkthrough (create, assign, complete, cross on Scout row)
Options: (a) I impersonate with the server key, (b) ask for your password, (c) you sign in to the preview and I drive it next turn, (d) a scripted walkthrough you run, (e) a repeatable browser check that runs once any real session exists, plus a written click-path for you/Codex.
**Chosen: (e) + (c).** Impersonation and pasted credentials break the project's security rules. I build a reusable end-to-end browser script and a short click-path; it runs automatically when a session is present, otherwise it records the exact blocker once.
Acceptance
- H1 Script signs in only via an injected/minted real session; never the server key.
- H2 Creates a synthetic task (`QA-` prefix), assigns to a teammate, completes it; row shows check + strike-through; second click is impossible.
- H3 Scout-linked task row on Home shows the same check + strike after its Comms message is recorded as sent.
- H4 Reload keeps the state; synthetic task is cleaned up.
- H5 With no session, the report says "blocked: no signed-in session" and marks nothing passed.

## 2. Spawn the bounded agent on a real task
Options: (a) run with in-memory logging only, (b) write runs into activities only, (c) wait for the run table, (d) mock-only proof, (e) run through the real path, recording receipts in the run table once applied, and fall back to an honest "run log unavailable" state.
**Chosen: (e).** Depends on Codex applying the proposed migration; I will re-verify schema first and never apply it myself.
Acceptance
- A1 Assigning a real low-risk internal task to Trust Tai AI starts exactly one run (repeat assignment reuses it).
- A2 Completed run shows in Home AI activity marked as agent work, with its evidence and output.
- A3 High-risk tasks stop at "needs approval"; nothing is sent, published, priced or committed.
- A4 If the run table is missing, the task stays saved and the UI says so; no fake completion.
- A5 The Scout task on Home reflects run status via the same row.

## 3. Agent uses Scout People details
Options: (a) paste all People into every prompt, (b) fetch web data, (c) let the model free-text names, (d) a retrieval tool the model can call, (e) server-side context builder that loads only the saved People for the task's linked Scout company, passes name/title/verified-email state as cited evidence, and validates that every named person in the answer exists in that set.
**Chosen: (e).** Deterministic, bounded to the workspace, auditable, no hallucinated people.
Acceptance
- P1 Only People from the linked company and same workspace (RLS as the caller) are loaded; max four.
- P2 Answers name real saved people with their saved titles and cite them as evidence.
- P3 Any name not in the saved set fails validation; run is marked failed, not completed.
- P4 No personal email/phone; unverified emails labelled as such.
- P5 No People saved → answer says so plainly; no invented contacts. No Apollo/Clay calls.

## 4. Steward task timeline
Options: (a) Gantt chart, (b) calendar, (c) new history table, (d) kanban, (e) vertical per-task timeline built from existing task records, activities and agent runs, plus a Timeline view on the Tasks page with status filters.
**Chosen: (e).** Reuses existing records (no new store), readable on mobile, familiar.
Acceptance
- T1 Each task shows Pending → In progress → Completed (or Needs approval / Failed) steps with date/time.
- T2 Each step shows who did it: person name or "Trust Tai AI"; unknown shown as "Unknown", never guessed.
- T3 Filter by status and owner; newest first; paged.
- T4 Missing history shows "Not recorded", not zero.
- T5 Existing Tasks list and deep links keep working.

## 5. Dedicated AI agent page in Steward
Options: (a) extend Agents tab, (b) chat window, (c) separate app, (d) Home widget, (e) new "Trust Tai AI" page under Steward: queue box (small input), live queue with status, and each run's response/evidence, with retry and cancel-before-start.
**Chosen: (e).** One clear place, reuses the same task store and runner; Agents tab links to it.
Acceptance
- Q1 Typing a task and pressing Queue creates a Steward task assigned to Trust Tai AI and starts a run.
- Q2 Queue shows Queued / Running / Needs approval / Completed / Failed with timestamps, refreshing live.
- Q3 Opening a run shows the response, evidence (incl. Scout People citations) and linked task.
- Q4 Only active workspace members see it; owners/admins can queue.
- Q5 Same bounds as A3; honest unavailable state if the run log is missing.

## Technical details
- New route `src/routes/modules.steward.ai.tsx` (+ tab in `modules.steward.tsx`); timeline component `src/components/tt/steward/task-timeline.tsx` fed by a read model in `src/data/steward/timeline-read.ts` (steward_tasks + activities + steward_agent_runs).
- `src/lib/steward-agent-context.server.ts`: loads scout_people by the task's `source_entity_id` prospect → company; runner validates named people against it.
- Browser QA script `scripts/qa/home-e2e.py`; results recorded in `docs/steward-bounded-agent-and-scout-send.md`.
- Tests: timeline mapping, People context/validation, queue actions, unavailable states. No SQL applied, no sends, no publish.

## Blockers you/Codex own
- A real signed-in session for items 1, 2 and 5 live checks.
- Codex applying `20260923190000_steward_agent_runs_and_source_links.sql` for durable agent runs.
