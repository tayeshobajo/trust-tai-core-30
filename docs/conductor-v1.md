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

## What v1 deliberately does not do

- No finance instrumentation: cash runway and recurring revenue read as
  `unknown` and are surfaced as critical blind spots rather than estimated.
- No model in the loop. The answers are deterministic and reproducible. A model
  may later phrase them more warmly; it may not add a fact.
- No stored conversation. `ConductorTurn` exists as a contract; history is not
  yet persisted.

## Next

1. Persist business intents through `stewardService` under the `intent` memory
   kind, with an editor in the console.
2. Instrument close rate and average deal size, which unlock the whole plan.
3. Record conductor turns as history, so learning has something to read.
