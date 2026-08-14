# Steward — Memory + Learning

> Steward does not manage people. Steward helps people remember what matters to
> one another.

Memory exists so Steward reads the *next* conversation better than it read the
last one, and so a person never has to explain the business twice. It holds how
work moves between people. It holds no verdict about anyone.

**No migration was required.** Everything below runs on the tables already
applied: canonical `public.conversations` and `public.commitments`, plus
`steward_role_memory` and the append-only `steward_beliefs` ledger.

## Where memory lives

`steward_beliefs` already carries what memory needs: append-only rows, org
scoping through the shared RLS helper, `tier`, `authority`, `supersedes_id`,
`evidence`, and who recorded it. So a memory row *is* a belief. The structured
part — facet, person, pattern key, the value before a correction — rides as one
reserved entry in the belief's `evidence` array (`steward-memory::{…}`,
`src/data/steward/memory-encoding.ts`) and is stripped on read. A person only
ever sees real evidence.

## A. Human correction → learning

A person edits a reading in place on the review surface (meaning, owner,
beneficiary, timing) and confirms once. Correcting is never punished with extra
steps.

`correctionsFromEdit` produces one record per field that actually moved.
`correctionToDraft` writes it as `tier: decided`, `authority: human`,
`supersedes_id` pointing at what it replaces, with the before and after both
kept. Nothing is deleted, ever. A cleared field is treated as no instruction —
absence of typing is not a deletion.

## B. Organizational memory model

Five kinds: `person`, `responsibility`, `handoff`, `project`, `correction`.
Relations are `carries`, `owns`, `depends_on`, `hands_off_to`, `prepares_for`,
`belongs_to`, `changed`.

`MEMORY_FORBIDDEN_TERMS` and `isPersonSafeStatement` make the person-centred law
executable: no score, rank, streak, reliability, productivity or personality
language can enter memory. Observations phrased as a judgement are dropped
before they are ever counted, and a test asserts it.

## C. Memory from repeated evidence

Threshold: **three distinct canonical conversations**
(`RECURRING_PATTERN_THRESHOLD`). One event is an event, two is a coincidence.
Repetition inside a single meeting counts once — a meeting talks about the same
thing many times.

Patterns are counted from **confirmed commitments**, not from one meeting's
interpretation, because a person put their name to each commitment. Steward
surfaces a qualifying pattern on the Memory page as "Steward has noticed a
pattern" and holds it only when a person says yes. Declining writes a decided
"not true" record, so it is never proposed again.

## D. Continuity across time

`proposeStateChanges` matches a new reading against live commitments by wording
overlap, requiring owner agreement when both sides name someone. It proposes
`already_completed`, `waiting`, `released` or `restated` — and **changes
nothing**. Only a person moves a status, because only a person knows whether "I
sent that over" meant the promised thing or something adjacent.

## E. Relationship / handoff memory

`prepares_for` and `depends_on` observations record who prepares what for whom
and who waits on whom, as facts about work flow. Never as a comment on a person.

## F. Memory surface

`/modules/steward/memory` groups beliefs by kind, leading with what people
taught. Each card shows tier, authority, facet, subject, the before/after of a
correction, how many conversations a pattern rests on, evidence, and who
recorded it. "This is no longer true" retires a belief: Steward stops consulting
it, and the record stays.

## G. Learning in the interpreter

`selectRelevantMemory` hands the model a bounded slice — people actually in the
room, projects actually named, capped by `MEMORY_SELECTION_LIMITS` — split into
`decided_memory` and `inferred_memory`. Interpreter law: decided memory is
settled and not re-litigated; inferred memory is context only; **when memory and
the transcript disagree, follow the transcript and say so**. Disagreements with
a decided correction are surfaced to a person by `flagMemoryConflicts` rather
than resolved silently.

## Fail-closed

`/api/public/steward/interpret` authenticates the bearer token and requires an
active `organization_memberships` row before any transcript, memory read or
model call. Memory being unreadable degrades the reading honestly; it never
fabricates memory.

## Acceptance (read-only)

`bun run scripts/steward-semantic-acceptance.ts` — Fathom 779145597, Bioptrics
plan update. Latest run:

- 633 segments → 32 candidates → clean owner-attributed readings
- 2 continuity proposals raised against prior work, 0 statuses changed
- 26 observations from the meeting → **0** patterns learned from one meeting
- the same 26 across 3 distinct conversations → 26 patterns offered for approval
- nothing written

Unit coverage: `src/data/steward/memory-learning.test.ts` (18 tests) over
corrections, thresholds, resolution precedence, continuity, bounded selection,
conflict surfacing, the person-safety law, and payload hiding.
