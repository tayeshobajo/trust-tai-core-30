# Steward. Judgment

## Purpose

Judgment answers one human question: **what deserves this person's attention now?**

It is not a priority algorithm, a task dashboard, a score, a kanban, a
notification centre or a surveillance system. A person can have twelve open
commitments and still have exactly one thing worth surfacing, and Steward must
be able to conclude that *nothing* needs them right now. That is a correct and
valuable answer, not an empty state.

Judgment is person-level stewardship. Pulse remains the leadership-level
attention surface. Intelligence knows, Pulse decides what deserves attention,
Steward makes sure people move.

## Architecture law

Judgment is **not a source of truth**. It creates no tasks, no commitments, no
parallel status system and no new tables. It reads canonical records other
rooms already own and produces an explainable recommendation:

| Room | What Judgment reads |
| --- | --- |
| Steward | `commitments`, `conversations`, memory beliefs |
| Projects | `ExecutionProject` state, owner, `blockedBecause`, next move |
| Comms | relationship owner, recorded response / follow-up due dates |
| Ops | shared `activities` rows, parsed through `readOpsEvents` |

**No migration is required.** Everything Judgment needs already exists in the
canonical schema. No DDL was written or applied.

## Domain contract

`src/domain/steward-judgment.ts`

- `JudgmentState`, the only five states.
- `AttentionItem`, person, state, headline, `whyNow`, canonical `refs`
  (`commitmentId`, `projectId`, `conversationId`, `relationshipId`,
  `decisionId`, `activityId`, `opsChainKey`), evidence, `sourceApps`,
  optional `nextMove`, optional `waitingOn` / `beneficiary`, `changedAt`,
  truth `tier`, `destination`, deterministic `order`, and a `patternKey` so
  dismissals can be counted honestly.
- `JudgmentRead`, one person's whole answer: `headline`, capped `items`,
  quiet `waiting`, `deferred` count, and `watching` notes.

Optional fields stay unset rather than guessed. Ambiguity is left unresolved.

## The five states

1. **Needs you**, someone is held up by this person's move.
2. **Waiting**, correctly waiting on someone else; usually nothing to do.
3. **Newly unblocked**, a recorded blocker changed state, so the work can move.
4. **Promise at risk**, a date a person actually set has passed or is upon them.
5. **Nothing needs you**, nothing earned an interruption.

## Derivation rules

`src/data/steward/judgment.ts`, pure functions, deterministic, no model calls.

**Needs you**
- An open commitment the viewer carries that was promised to a named person.
- A project the viewer owns recorded as `blocked`.
- A Comms reply the viewer owns with a recorded due date landing today.

**Waiting**
- The viewer's commitment marked `waiting` by a person: no chase for the first
  `WAITING_FOLLOW_UP_DAYS` (7). After that a follow-up move is offered, because
  the length of the silence is itself evidence.
- A commitment someone *else* carries where the viewer is the beneficiary. The
  viewer sees "waiting on X", never a duplicate of X's work.

**Newly unblocked**
- An Ops chain whose latest event is a clearing event (`qa_passed`,
  `fix_applied`, `rollback_performed`, `completed`) that supersedes an earlier
  risk event on the same chain, within the last 7 days, and whose canonical
  project or commitment belongs to the viewer.

**Promise at risk**
- A commitment with a `dueAt` a person set, now past or within
  `AT_RISK_WINDOW_DAYS` (1). `dueText` alone never produces urgency.
- A Comms reply past a recorded due date.

**Nothing needs you**
- Emitted whenever no item survives the filter.

Ordering is `STATE_STRENGTH` then age of the change then id, the same input
always yields the same sequence. At most `MAX_ATTENTION_ITEMS` (3) may
interrupt; anything beyond that is reported as a `deferred` count.

## Suppression rules

- `kept` and `released` commitments never surface.
- Commitments a person already settled through Memory (`authority: "human"`
  with `marked_kept`, `released` or `retired`) never resurface: a human
  decision beats a stale reading.
- Patterns dismissed as context past the existing threshold are dropped.
- Work in another organization, or belonging to another person, is excluded.
- Open work with no date, no beneficiary and no blocker is *not* surfaced.
  Existing is not a reason to interrupt someone.
- Several readings of the same canonical work collapse into one item: the
  stronger state wins and the other room's evidence, refs and source apps are
  folded in.

## Explainability

Every surfaced item opens into "Why this?": the truth tier (observed, inferred
or decided), the date of the change, who is affected, each piece of evidence
with its link where one exists, and which canonical record it rests on. When
Judgment consults Memory it obeys the existing bounded-memory law, and current
canonical truth always outranks a remembered belief.

## Today UX

`/modules/steward` is now the Judgment surface. One dominant answer first, "One thing needs you." / "Nothing needs you right now.", then at most three
items, each with a "Why now" line, progressive disclosure into evidence, a link
to the conversation, and a link to the owning room for execution. Correctly
waiting work sits quietly beneath, or appears as "what Steward is watching"
when nothing needs anyone. No charts, counters, scores or traffic lights.

## Sharing with Pulse

`judgmentContextBlocks(read)` expresses a judgment in the shared context shape
so Intelligence or Pulse can consume it later. Pulse is deliberately unchanged.

## What Judgment deliberately does not do

- No numeric priority score, confidence meter or urgency colour in the UX.
- No productivity, reliability, responsiveness or compliance scoring, ranking
  or team comparison. Judgment never evaluates a human.
- No inference of emotion, motivation, character or intent.
- No invented owners, deadlines, project links, beneficiaries or completions.
- No writes: it never changes a status, and never creates work.
- No new tables and no duplicate representation of canonical work.
