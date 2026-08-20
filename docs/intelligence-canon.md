# The Intelligence Canon

The suite already knows what happened. The canon is how it recognises what kind
of situation it is looking at, and how a situation that resolves makes the next
reading better.

**Operating principle: small input, deep intelligence, clear output.**

## Phase 1 audit: what already behaved like this

| Already present | Where | What it gives us |
| --- | --- | --- |
| Deterministic observations | `engine/observe.ts` | 22 dated, counted facts across every room. The canon matches against these rather than raw tables. |
| Hypothesis formation | `engine/hypothesise.ts` | Grouping into readings, with a packet the model may not exceed. |
| Verification | `engine/verify.ts` | Drops claims the packet does not support, and any invented number. |
| Belief ledger | `steward_beliefs` + `engine/learn.ts` | Accept / edit / defer / reject, append-only, two rejections suppress. |
| Outcome ledger | `conductor_observations`, `conductor_learning` | Was the expected signal present after approved work. |
| Signals and visibility | `derive.ts`, `pulse/projection.ts` | Actionable signals routed to the owning room. |
| Blind spots | `conductor/blindspots.ts` | What could not be read, named rather than guessed. |

**Gap map, before this phase**

1. No named situations. Every reading was assembled from scratch each time, so
   the suite could say "this project is late" but not "this looks like ownership
   ambiguity, and here is what would tell it apart from a capacity problem."
2. No competing explanations. A reading was single threaded.
3. No missing-evidence contract. Absent evidence was silence, not a request.
4. No case memory. The outcome ledger learned about *recommendations*, not about
   *kinds of situation*.
5. No structured diagnostics. Chains existed only as prose in room docs.

The canon fills exactly those five gaps and nothing else. It duplicates no
observation, owns no entity and adds no execution path.

## The model

Definitions live in code, versioned with the app: patterns
(`data/intelligence/canon/patterns.ts`) and diagnostic chains (`chains.ts`).
Only what an organization *learned* needs a table:
`intelligence_cases` and `pattern_outcomes` (`docs/intelligence-canon-schema.sql`),
both append-only, org scoped, active membership only, insert and select only.

Contracts are in `src/domain/intelligence-canon.ts`.

## Matching

`matchPatterns()` is deterministic. It reads the same observations the engine
already made, and for each pattern:

1. Required triggers are checked; a pattern with no required trigger met is not
   a weak match, it is a different situation, and returns nothing.
2. Optional triggers can nudge the score, never carry it.
3. Negative indicators subtract, and any contradicting fact drops confidence to
   "not established".
4. Confidence starts at the pattern's own cap and is only ever lowered: missing
   evidence or a single supporting fact both lower it.
5. Every matched fact keeps the evidence lane it arrived in. A match can never
   turn what a founder said into something the suite observed.

A match carries what supported it, which required conditions found nothing and
where to go and look, what argues against it, the competing explanation and how
to tell them apart, the chain to run, and the rooms that own each possible move.

## Where it shows up

- **Conductor** attaches up to three matches to an answer and voices the top one
  only when the evidence clears the threshold, always with its competing
  explanation and what to check first.
- **Pulse** may put one short phrase on a signal that already exists, at most
  one per room. No pattern cards, no second feed, no reordering.
- **Canon surface** inside the Conductor room: patterns, chains, cases and what
  the outcomes so far suggest. Read only.

## Learning

`openCase` records a situation at the moment a person decided about it, by
reference. `resolveCase` adds what happened, whether the diagnosis held, and the
person's correction if it did not. `recordPatternOutcome` appends what the
recommendation produced.

Governance is deliberate:

- A human correction outranks anything inferred from a result.
- One outcome is never a rule. Guidance needs three consistent results.
- Nothing rewrites canonical pattern text. Repeated evidence produces a
  `PatternRevisionProposal` with `requiresApproval: true`.
- Learning never expands authority: no case, outcome or lesson can authorise an
  action or lower an approval requirement.

## The capture loop

A reading becomes experience only through a person:

1. **Surfaced.** A match appears on a Conductor answer. Looking at it records
   nothing at all.
2. **Decided.** "I acted on this" opens a case with the pattern, the observation
   ids the reading stood on, the hypothesis shown, and the decision in the
   person's own words. "Not useful" goes to the existing Conductor correction
   ledger instead, because there is nothing to learn from a reading that was not
   worth raising.
3. **Corrected.** "The reading was off" stores the person's words on the case as
   human authored truth. `priorExperience` says it first, ahead of anything
   worked out from results.
4. **Reconciled.** `reconcileCase` re-reads the same observations the suite
   already makes. The shape gone means success; the same shape still observed a
   week after the decision means failure; anything else writes nothing.
   Reconciliation is limited to observation kinds that clear cleanly
   (`VERIFIABLE_KINDS`). Everything else waits for a person to record what
   happened.
5. **Retrieved.** When the same pattern surfaces again, the organization's own
   cases and corrections appear in their own lane, clearly separated from
   today's evidence, and never raise the pattern's confidence.

Both tables are append only and hold no natural key, so idempotency is enforced
by content: `caseFingerprint` and `outcomeFingerprint` make a retry, a double
click or a re-render resolve to the row already written.

## Deliberately not built

No embeddings, no vector store, no background loop, no autonomous execution, no
per-pattern confidence percentages, no pattern feed in Pulse, and no changes to
the Website intake or Scout contracts.
