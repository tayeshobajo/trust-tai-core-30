# Projects — the execution room for approved roadmap milestones

Rebuild the Projects index as a company-aware delivery surface where every project keeps its lineage visible: Company → Roadmap → Milestone → Project → Delivery → Outcome. Same visual language as the redesigned Scout and Roadmap rooms (white/cloud, serif page statement, compact toolbar, right rail).

## What the page becomes

**1. Compact header**
Eyebrow `PROJECTS`, serif title "Approved work, in motion.", two supporting lines, primary `+ Create project`, secondary `View roadmap handoffs` (jumps to the Ready-from-Roadmap section).

**2. Operating signals**
Four cards only: Active projects, Need attention, Due this week, Blocked — with a small "Across N companies" line. No analytics dashboard.

**3. Needs attention**
Above the list, only genuine exceptions (blocked, in review with a due date inside 2 days, at risk). Each row: company mark + name, project name, one-sentence reason, owner, "Blocked for N days" or "Due tomorrow", and an `Open project` / `Review` action. The whole section disappears when empty.

**4. Tabs + toolbar**
Tabs: All projects · In progress · Needs attention · Waiting · Completed.
One horizontal toolbar: search (projects, companies, milestones) plus Company, Owner, Status, Due selects — options drawn only from what exists. A small Projects | Companies view toggle sits at the toolbar's right.

**5. Project cards (the heart)**
Each card carries: company logo + name, status pill, project name, lineage line (`Roadmap → Milestone 02`), Outcome, Owner, Due, delivery progress ("4 of 7 delivery items complete") or current stage, current work item, blocker when present, `Open project` and `Open roadmap`.

**6. Companies view**
Same data grouped by company: active project count, milestones complete, compact project rows, `View company work`. Project-first stays the default.

**7. Ready from Roadmap**
A section listing approved, Decided milestones that have no project yet — company, milestone ordinal and name, "Approved · Ready for execution", `Create project` (uses the existing strict handoff, so nothing enters delivery on a proposal).

**8. Right rail**
This week (due / reviews / blocked) · Needs Tai (items awaiting judgment, linked) · Recently completed. No activity feed.

**9. Left sidebar contextual area**
"Projects at a glance" (Active, Needs attention, Blocked, Due this week) and "Your driver" — "Keep approved work moving." with a `View roadmap handoffs` link.

**10. Empty state**
"No approved work has entered delivery yet." + "Projects begins when a Roadmap milestone is approved for execution." + `Open Roadmap` / `View approved milestones`, with a simple `Roadmap milestone → Project → Delivery` flow line.

## Status and health language

Surface statuses: Ready · In progress · Blocked · Waiting · In review · Complete — mapped from the existing internal execution states (`not_started`, `in_flight`, `in_review`, `blocked`, `delivered`, `closed`) rather than replacing them.
Health stays derived and explainable: On track · Needs attention · At risk · Blocked, each with its plain sentence ("Needs attention because the milestone is due in 2 days and 3 delivery items remain."). No opaque scores.

## Technical notes

- **No DDL required.** The externally managed `projects` table already tolerates extra execution detail through `metadata` in `projects-service.ts`. Due date, delivery items, current work item, and blocked-since timestamp are read from a real column when one exists and from `metadata` otherwise — the same read-prefer-column pattern already used for `point_a`/`point_b`/`next_move`.
- **New read model** `src/data/projects/index-projection.ts`: pure functions producing surface status, health with reason, delivery progress, lineage, tab buckets, filter options, glance counts and rail sections. Unit-tested alongside the existing projects tests.
- **Lineage resolution**: company from `clients` via `client_id` (falling back to `origin.subjectLabel`), roadmap and milestone ordinal from `origin.roadmapId` / `origin.milestoneId` against the roadmap read already used by the Roadmap index.
- **Ready from Roadmap**: decided milestones minus milestones already referenced by a project origin; conversion reuses `projectFromMilestone` in `src/data/projects-handoff.ts` unchanged.
- **Reused components**: `CompanyMark` from `company-identity.tsx`, the Scout toolbar/pagination/rail patterns, `AppShell`'s `sidebar` slot.
- Ops stays separate; a `Send to Ops` handoff on completed recurring work is noted for the inner project page, not built here.
- Inner project page is out of scope for this change.

## Files

- `src/routes/modules.projects.index.tsx` — rewritten as the new room.
- `src/components/tt/projects/index/` — header, signals, needs-attention, toolbar, project-card, companies-view, ready-from-roadmap, support-rail, sidebar.
- `src/data/projects/index-projection.ts` + tests — deterministic read model.
- `src/data/supabase/projects-service.ts` — read due date, delivery items, current item and blocked-since through the existing tolerant metadata path.
