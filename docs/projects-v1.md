# Projects v1

Projects is the delivery room. It is not a task tracker and not a PM dashboard.

## The one job

Carry Decided work from Roadmap into delivery, and keep one honest read on it:
where it started, where it is going, who carries it, what is blocking it, and
the single next move.

## Truth boundary

- **Roadmap decides what gets built.** A milestone must be `approved` and
  `decided`, unblocked, and owned before it can enter Projects. Anything short
  of that is refused out loud with the reason (`src/data/projects-handoff.ts`).
- **Projects records what is happening to that decision.** It never invents
  work, never scores it with a model, and never claims progress that nobody
  wrote down.
- Evidence is inherited from the milestone, not re-authored.

## Execution states

`not_started → in_flight → in_review → delivered → closed`, with `blocked` as a
state a person sets and must explain.

Health is derived, never typed in, and always explains itself
(`src/domain/projects.ts`):

- **At risk**, blocked, or nothing has moved for 14 days.
- **Needs attention**, no owner, no destination, or no next move.
- **On track**, owned, moving, with a recorded next move.

## Handoff

`Roadmap → Build Order → Start in Projects` is idempotent. A milestone has at
most one project: pressing the button twice opens the same work. Idempotency is
enforced in the service and, once `docs/projects-v1-schema.sql` is applied, by a
unique index on the milestone origin.

## Persistence

The shared `public.projects` table, read and written under the caller's own
access. Execution detail (origin, evidence, dependencies, boundary, blocked
reason, last moved) is mirrored into `metadata`, so a column difference in the
externally managed schema can never lose a person's work. Every state change is
mirrored into the shared `activities` stream as `project.started`,
`project.blocked`, `project.status_changed`, or `project.next_move_changed`.

## Intelligence

Projects contributes to the suite snapshot like every other room
(`src/data/intelligence/derive.ts`): two context blocks per project (state as
Decided, health as Inferred) and a delivery signal whenever open work is at risk
or cannot move. Ask Trust Tai answers about delivery from those blocks only.

## Routes

- `/modules/projects`, the room: asking for you, incomplete, in flight, landed.
- `/modules/projects/$projectId`, one piece of work, its evidence, and its move.

## Canon laws that bind this room (2026-09-06)

- Execution state never derives from, or moves, the client's commercial tier
  (canon 12).
- Chat is how you talk to the project; Projects remains where project truth
  lives (canon 13). The Chat tab is session scoped and writes nothing.
- Anything the page flags is resolvable from the Update project panel: state,
  block, owner, and the wait itself. Waiting stays derived from `waitingOn`,
  which the panel can set and clear (canon 15).
- Owner is picked from active workspace members and written through
  `projectsService.update`, under RLS with the same provenance as every other
  project write. In-flight and in-review work cannot be left with nobody
  (`checkOwnerAssignment`).

## Correcting a project (canon 16, 2026-09-06)

Manage project has two halves, because they are two different decisions.

**Project details** corrects what a person typed. Editable:

| Field | Owned by | Notes |
| ----- | -------- | ----- |
| Project name | Projects | Cannot be blanked. |
| Point A | Projects | Free to correct, may be emptied. |
| Point B | Projects | Cannot be blanked once the work is Delivered or Closed, because that claim was made against it. |
| Agreed date | Projects | Canonical (`dueDate`, column with metadata mirror). Clearing it says no date was really agreed. |
| Company this serves | Projects, manual work only | `origin.subjectLabel`. Read-only when the work came from an approved milestone, because Roadmap owns that lineage. |
| Owner | Projects | Changed on the rail owner picker, from active members. |

Intentionally immutable, and the panel says so:

- **Roadmap lineage** (`origin.roadmapId`, `origin.milestoneId`). Rewriting it
  would rewrite where a decision came from.
- **Client attachment** (`clientId`). Moving delivery between companies is a
  correction made in Clients, never a dropdown here.

**Move the work** keeps state, block, waiting and next move exactly as canon 15
requires. Waiting stays derived from `waitingOn`.

Every correction is refused before it is written by `checkDetailEdit`
(`src/domain/projects.ts`), written through `projectsService.update`, and
recorded as `project.updated` with the changed field names and their previous
values. Saves confirm on screen and refresh the read.
