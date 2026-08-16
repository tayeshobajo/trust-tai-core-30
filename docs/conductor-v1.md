# The Conductor — v1

The Conductor is the command layer over Steward and Intelligence. It is not a
peer business app. It owns no entity, writes no room's truth, and executes
nothing. It reads the whole factory and answers in plain language.

## Where it sits in the law

`docs/architecture-canon.md` is unchanged by this addition:

- Apps own state. The Conductor never writes Scout, Comms, Roadmap, Projects,
  Ops or Studio truth.
- Core owns identity and shared entities. The Conductor introduces none.
- The event stream owns cross-app history. The Conductor reads it.
- Steward owns interpretation, memory, judgment and routing. Business intents
  ride Steward's append-only belief ledger under the `intent` memory kind —
  there is no second truth store.
- Pulse owns visibility. The Conductor is a conversational surface over the
  same reads, not a competing dashboard.
- Owning rooms execute. Every bounded action routes to its room and requires a
  person.

## The pieces

| Module | Responsibility |
| --- | --- |
| `src/domain/conductor.ts` | Contracts: `ValueBasis`, `BusinessIntent`, vital-sign registry, factory graph, plan, blind spot, improvement, answer |
| `conductor/vitals.ts` | Deterministic vital signs from the suite snapshot and decided intents |
| `conductor/factory.ts` | The factory graph: throughput per stage across two windows, upstream falls with lag |
| `conductor/blindspots.ts` | What the business cannot see, and the instrument that would answer it |
| `conductor/plan.ts` | Decomposes one decided outcome into room-by-room targets |
| `conductor/improve.ts` | Repeated friction → approval-gated system proposals |
| `conductor/answer.ts` | Question classification and answer composition |
| `components/tt/conductor/conductor-console.tsx` | The conversational surface |
| `routes/modules.conductor.tsx` | The room |

## The rules that make it trustworthy

**Basis on every number.** Observed, decided, derived, or unknown. A derived
number may only rest on observed or decided inputs. Nothing is inferred into a
gap.

**Refusal is a valid answer.** If close rate is unknown, a revenue goal does not
decompose. The plan stops, names the missing input, and returns the blind spot
instead of a plausible figure. `buildOperatingPlan` returns
`complete: false` with zero targets, and a test holds that line.

**Assumptions are visible and inherited.** The conversation-to-opportunity and
qualified-to-conversation rates are not instrumented anywhere in the suite, so
the plan states the shape it is using, marks it `unknown`, and every target
derived from it carries the assumption key.

**Friction needs three occurrences.** Two is a coincidence. Below
`FRICTION_THRESHOLD`, the Conductor stays quiet.

**No silent execution.** Every proposal carries `requiresApproval: true`, is
reversible, and states what it will not do. Every answer restates the boundary
in `CONDUCTOR_CONTROL`.

**Partial reads say so.** Rooms that could not be read are listed on the answer
with the reason, and nothing is inferred in their place.

## Recorded figures — the instrument of last resort

Cash, burn, receivables, close rate, average deal size and sales cycle are
numbers no room in the suite will ever count for itself. Rather than leave the
survival question permanently unanswerable, a person records them by hand in
the console. Each figure carries the date it was **true**, not the date it was
typed, and the name of whoever recorded it.

Two rules keep this honest. A figure older than `FIGURE_STALE_DAYS` (45) may
still be used but never reads healthy. A figure older than `FIGURE_EXPIRY_DAYS`
(120) stops being a figure and returns to `unknown` — a business is not steered
on a four-month-old bank balance. Runway is then arithmetic over two decided
inputs, and is labelled `inferred`, never `observed`.

## Learning — corrections, not retraining

Every answer can be contradicted, four ways: a wrong number, a wrong read, work
already handled, or a suggestion that is simply not useful. A correction is
appended with a name and a reason, and it changes the next answer in a way
anyone can inspect:

- a corrected number becomes a `decided` figure and outranks the standing
  record for that key;
- a rejected suggestion goes quiet for `CORRECTION_SUPPRESSION_DAYS` (14) and
  then may be raised again, because a thing not worth doing in March may be
  worth doing in June.

Nothing here rewrites history, retrains a model, or edits code. The corrections
ledger is the memory; `learningState` is the only reading of it.

## Persistence

Three tables, defined in `docs/conductor-v1-schema.sql` and applied to the
managed Trust Tai project: `business_intents`, `business_figures` and
`conductor_corrections`. All three hold only what a person decided or
corrected — the Conductor still owns no business entity and duplicates no
room's truth. RLS reuses the existing `private.is_org_member`, `anon` holds no
privilege, and figures and corrections are append-only.

## What v1 deliberately does not do

- No automatic finance instrumentation: cash and burn are hand-recorded, and
  read as `unknown` — surfaced as critical blind spots — until they are.
- No model in the loop. The answers are deterministic and reproducible. A model
  may later phrase them more warmly; it may not add a fact.
- No stored conversation. `ConductorTurn` exists as a contract; history is not
  yet persisted.

## Next

1. An editor for business intents in the console, so outcomes are decided in
   the same place they are measured.
2. Connect a finance source so cash and burn become `observed` rather than
   hand-recorded.
3. Record conductor turns as history, so the learning trail shows the answer a
   correction was made against.
