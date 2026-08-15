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
