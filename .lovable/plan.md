# Project inner page — the delivery room

Rebuild `/modules/projects/{id}` as a calm delivery cockpit for one approved roadmap milestone. It answers four things at a glance: what we are building, why, what is moving now, and what is stopping it.

The chain stays visible everywhere: Company → Roadmap → Milestone → Project → Delivery → Outcome.

## Page frame

**Top utility row** — breadcrumb `Projects > Company > Project`, with Open roadmap, More actions, and Previous / Next moving through the same company's projects.

**Header** — company logo and name, project name, status chip, `Roadmap Milestone 02` line, and metadata: Owner, Due, Health, Last updated. Primary action `Update project`; secondary `Open roadmap milestone`. A subtle Ambient Identity Wash uses the company's real brand colour where one is recorded, otherwise nothing.

**Outcome strip** — one sentence, directly under the header, held visually strong and plain. The project never loses the reason it exists.

**Tabs** — Overview | Work | Blockers | Decisions | Files | Activity.

## Overview

- **Where this stands** — status, current stage, delivery progress (4 of 7), due, owner, health, plus one derived sentence explaining the state ("Work is moving normally. No active blocker is preventing delivery.").
- **Current work** — only the item actively in progress: owner, started, due, status, short description. Actions: Open work item, Mark ready for review.
- **Up next** — the next Ready item in the recorded sequence, why it follows, and Start when ready.
- **Blocker** — prominent only when a blocker is open: reason, blocked for N days, owner, impact, with Resolve blocker and Send follow up via Comms. Otherwise a quiet "No active blockers."
- **Why this project exists** — roadmap, milestone, Point B contribution, and Open roadmap. Read from Roadmap truth, never restated.

## Right rail

- **Needs attention** — only what requires judgment, with a single Review action; otherwise "Nothing needs your judgment right now."
- **Project health** — the state plus the signals behind it (items complete, blockers, next due item, client response). No invented scores.
- **People** — owner, contributors, client contact. Not a directory.
- **Quick actions** — Add work item, Add blocker, Request decision, Upload file, Send update via Comms.

## Tabs

- **Work** — the delivery list: title, status (Ready / In progress / In review / Blocked / Complete), owner, due, review state, linked milestone, and a dependency only when one was actually recorded.
- **Blockers** — register of every blocker with owner, date raised, impact, status, next move, and Resolve. Resolved blockers stay in history.
- **Decisions** — project-level delivery decisions only: question, why it matters, owner, status, related work item, answer. Roadmap direction decisions stay in Roadmap and are never rewritten from here.
- **Files** — real uploads to a Supabase storage bucket, grouped as Working files / Client deliverables / References, each with name, type, uploaded by, date, linked work item, and Open / Download.
- **Activity** — the project timeline from the existing shared activity stream: created from milestone, work started, blocker raised, decision recorded, item completed, moved to review.

## Completion and Ops handoff

When delivered, the page reads as an outcome, not "Done": outcome summary, what changed, and a Roadmap signal that Milestone 02 is ready to be marked complete, with `Return outcome to Roadmap` as an explicit human action. Strategic truth is never auto-updated.

If the finished work creates recurring work, an "Ongoing work recommended" card lists it with `Send to Ops`, using the existing request-only routing contract. Projects builds; Ops maintains.

## Technical notes

New backend tables (I write the SQL to `docs/projects-delivery-schema.sql`; you apply it to `okydosoacqdnursmmenf` as one migration, same as the roadmap exports schema):

- `project_work_items` — project_id, organization_id, title, description, status, owner_user_id, owner_label, due_date, sequence, review_state, depends_on, timestamps.
- `project_blockers` — project_id, reason, impact, owner_label, raised_at, resolved_at, status, next_move.
- `project_decisions` — project_id, question, why_it_matters, owner_label, status, work_item_id, answer, decided_at.
- `project_files` — project_id, storage_path, name, kind (working / deliverable / reference), work_item_id, uploaded_by, created_at.
- Storage bucket `project-files`, private, with org-scoped policies; downloads via signed URLs.

Every table follows the shared contract: GRANTs to `authenticated` and `service_role`, RLS enabled, policies reusing `private.is_org_member`. No anon access.

Frontend work:

- Split the route into `src/components/tt/projects/detail/*` — utility row, header, outcome strip, tabs, overview cards, right rail, and one file per tab.
- New services in `src/data/supabase/` for work items, blockers, decisions, and files, each writing to the shared activity stream on change, and pure read models in `src/data/projects/detail-projection.ts` for current work, up next, progress, health signals and the completion summary.
- Reuse the existing state machine (`checkTransition`), surface-action language, lineage strip, company identity/brand lookup and route-work (Ops) contract. Existing state-change behaviour is preserved, just relocated into the new frame.
- Tests for the projections: current work / up next selection, progress and health signals, blocker ageing, and completion summary.

## Out of scope

No new roadmap-editing power from this page, no cross-project task board, no full asset manager beyond the four file operations listed.
