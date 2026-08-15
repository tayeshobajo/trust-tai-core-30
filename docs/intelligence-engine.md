# Intelligence Engine — how Trust Tai reads its own business

The suite already knows a great deal: who is in the pipeline, what is being built, what
went quiet, what someone promised. Nobody was reading it all together. The Intelligence
Engine does that, and only that.

**Operating principle: small input, deep intelligence, clear output.**

## What it is, and what it refuses to be

It is a reasoning layer over rooms that already own their truth. It owns no entity, has no
table of its own, and changes nothing in Scout, Comms, Roadmap, Projects, Ops or Steward.
It reads broadly and writes one thing: what a person decided about a proposal.

It is not a scoring system, a notification centre, a task queue, or a productivity monitor.
It never comments on a person's performance. It talks about the business.

## The loop

```text
observe  → deterministic facts from the suite snapshot
hypothesise → group observations into candidate readings
remember → what people already decided and already rejected
judge    → drop anything decided against or suppressed
reason   → a model connects observations across rooms (optional)
verify   → drop anything the packet does not support
recommend → bounded proposals, each routed to the owning room
decide   → a person accepts, edits, defers or rejects
learn    → the decision is appended to the belief ledger
```

Every stage except `reason` is pure and deterministic. If the model stage is unavailable —
no provider, no session, a refusal — the read still lands and says it is deterministic.
Nothing goes blank and nothing is invented to fill the space.

## The laws, and where they are enforced

| Law | Where |
| --- | --- |
| Nothing asserted without evidence | `verify.ts` drops any claim whose `observationRefs` are not in the packet |
| No number nobody counted | `inventsNumber()` — money, percentages and rates are never in the packet, so never in a claim |
| No certainty the evidence cannot carry | `CAUSAL_MARKERS` in `verify.ts` |
| A person's decision outranks inference | `contradicts()`, applied in both `engineRead()` and `verify.ts` |
| A rejected shape is not raised again | `enginePatternsToSuppress()` from the belief ledger |
| Reasoned readings never exceed moderate confidence | `capConfidence(..., "moderate")` |
| Volume is bounded | `MAX_HYPOTHESES`, capped recommendations |
| Silence is a valid answer | An empty read renders as an honest sentence, not an error |

## Themes

Seven shapes of business health, deliberately few: `capacity`, `delivery`, `pipeline`,
`follow_through`, `friction`, `client_risk`, `opportunity`.

## The evidence packet

The model never sees the database, a transcript, or free text. It receives a packet of
statements the suite already made, plus the decided statements it must not contradict, the
patterns it must not raise, and the rooms that could not be read. Everything it returns is
checked back against that same packet before a person sees it.

The endpoint is `POST /api/public/intelligence/reason`. It authenticates every request
itself: a Trust Tai access token plus an active `organization_memberships` row. No token is
401, no membership is 403. It reads nothing and writes nothing.

## Learning

Accept, Edit, Not now, Not useful. Each is appended to the existing `steward_beliefs`
ledger through the reserved memory prefix — append-only, attributed, and reversible by
another human decision. Two rejections of the same pattern suppress it. An edit is a
precedent: the person's wording is what the engine learned, not its own.

## Action boundary

v1 proposes. `ActionProposal` exists in the contract with `requiresApproval: true` so that
when a room can accept one, nothing about the shape has to change. There is no silent path
to action, now or later.

## Surfaces

- **Pulse** — the full read: headline, proposals, what it rests on, what it could not read,
  and which decisions it respected.
- **Home** — one line and the single proposal that would change the day, with a door into
  Pulse. Home stays a doorway.

## Deliberately not built

No schema, no scheduler, no background loop, no per-user notification state, no confidence
percentages, no charts. The read is taken when a person looks.

## Action proposals and authorization

A recommendation says what is worth doing. An **action proposal**
(`src/data/intelligence/engine/propose.ts`) is the smallest reversible piece of
that work, named as an operation the owning room already performs
(`comms.draft_reply`, `scout.route_to_comms`, …) and routed there.

Laws:

1. **The engine never executes.** Every proposal carries `requiresApproval: true`.
   Authorising it records permission and hands the person to the owning room;
   the work is done there, by that person.
2. **Every action is bounded.** `willDo` and `willNotDo` are both non-empty and
   shown side by side before anyone can authorise.
3. **Only reversible work is proposed.** Irreversible work stays advice.
4. **A hunch earns no action.** Low or unknown confidence routes a person to
   look, never to act. At most `MAX_ACTION_PROPOSALS` per recommendation.

`intelligenceService.authorizeAction()` writes one append-only activity event
(`decision.approved` / `decision.decided`) naming the person, the room, the
operation, its boundaries and the route. Declining is recorded too, so the
engine stops offering that step unprompted.

## Suite-wide evidence

The engine reads every room the workspace can legitimately see: Scout, Comms,
Roadmap, Projects, Ops, Steward, and the shared activity record (250 most
recent events, wide enough for cadence over several weeks). Steward's belief
ledger travels inside the snapshot, so what a person already decided is
evidence during observation rather than a second read afterwards.

Observations now include roadmap direction and staleness, open Ops signals,
per-room quiet periods, weekly activity volume, recurring remembered work, and
settled human decisions. Anything a room refuses to return is listed as
withheld, never guessed at.

## When the engine runs

`engine/runs.ts` is pure: `snapshotFingerprint` turns a snapshot into a short
string that changes exactly when evidence does, and `shouldRun` decides between
`first_run`, `new_activity`, `daily_cadence`, `requested` and `up_to_date`.
`useIntelligenceRuns` owns the timers: it reads on arrival, checks every two
minutes, refreshes on window focus, and renews daily. When nothing moved the
read on screen is kept and the model stage is not asked again. A person can
always ask for a read now.

## Learning audit trail

`engine/audit.ts` derives the trail from the append-only ledger — there is no
second copy of the truth. Each entry shows the decision, who made it, when, and
the exact consequence: suppressed, one dismissal away from suppression, wording
adopted, offered earlier, or held for later. Suppression is a count, not a
verdict: the same reading must be dismissed twice before the engine stops
raising it. Accepting something changes ordering only — never confidence.
