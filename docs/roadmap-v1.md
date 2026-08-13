# Roadmap v1 — the sequencing room

Roadmap's one job: **turn what we already know about a client, prospect or
relationship into a clear, sequenced path someone can follow.**

Point A (current truth) → Point B (destination) → The Walk (stages) → Next move.

## What is real in v1

- Roadmaps, stages and decisions persist to the shared Trust Tai Supabase
  project, organization-scoped through the existing `private.is_org_member`
  RLS helper.
- Drafts are composed **deterministically** by `src/data/roadmap-draft.ts` from
  evidence already stored in `clients`, `prospects` and `comms_relationships`.
  There is no model in the loop, so there is nothing to hallucinate.
- Every state change is mirrored into the shared `activities` stream under
  `roadmap.*` event names with full provenance.
- Roadmaps are idempotent per subject: a second draft for the same prospect
  returns the roadmap that already exists.

## What is deliberately not here

- No AI generation of stages, timelines, budgets or client commitments.
- No new company or people entities. Subjects are pointed at by id.
- No Gantt charts, capacity planning, or task management. That is Projects.

## Truth separation

The rule that governs every screen:

| Tier | Where it can appear | Rule |
| --- | --- | --- |
| Observed | Point A only | Must carry its own evidence reference |
| Inferred | Point B proposals, method stages, next move | Always labelled, never presented as fact |
| Decided | Approved Point B, resolved decisions | Only ever created by a person |

A proposed destination stays **Inferred** until someone presses "Approve this
destination". That press is the moment it becomes **Decided**, and it is
recorded with who approved it and when.

Where evidence is too weak, Roadmap writes `Unknown — needs confirmation` and
lists the gap under "Not established". It never fills a gap with a guess.

## The Walk

Stages come from the Trust Tai method, not from a claim about the client:

1. Confirm current truth — only when gaps remain
2. Agree the destination
3. Sequence the build order
4. Build the first move
5. Hand over and steward

Each stage is marked Inferred and carries computed evidence naming the method.
Stage states reuse the canonical lifecycle vocabulary: Mapped, In build, Live,
Blocked. Ownership is a named person, or visibly no one.

## Decisions

Decisions sit above activity everywhere. Each one states the question, why it
matters, the options, what it rests on, and — only when observed evidence
supports it — a recommendation clearly marked as suggested. Resolving a
decision records who resolved it, when, and their note.

## Files

| Path | Role |
| --- | --- |
| `src/domain/roadmap.ts` | Contracts: `Roadmap`, `RoadmapStage`, `RoadmapDecision`, tiers |
| `src/data/roadmap-draft.ts` | Pure, deterministic draft composition |
| `src/data/supabase/roadmap-schema.ts` | Row shapes, mapping, not-ready detection |
| `src/data/supabase/roadmap-service.ts` | The only place roadmap state is written |
| `src/data/supabase/roadmap-subjects.ts` | Subjects a roadmap can be about |
| `src/routes/modules.roadmap.index.tsx` | Roadmap home: decisions, then active work |
| `src/routes/modules.roadmap.$roadmapId.tsx` | The roadmap workspace |
| `docs/roadmap-v1-schema.sql` | Schema to apply to the Trust Tai Supabase project |

## Before it works

`docs/roadmap-v1-schema.sql` has **not** been applied yet. Until it is, both
Roadmap routes render a truthful "Roadmap is not set up in this workspace yet"
state with the exact backend message. No fixtures, no demo data.

## Tests

`src/data/roadmap-draft.test.ts` — 15 tests covering tier separation, Unknown
handling, destination inference vs decision, recommendation gating, method
stage composition, determinism, and the assertion that no stage ever mentions a
timeline or budget.
