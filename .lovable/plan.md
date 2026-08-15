# Trust Tai Intelligence Engine — architecture proposal

Today the OS has excellent parts and no living whole. `loadSuiteSnapshot` reads every
room on demand, `derive.ts` turns that snapshot into `ContextBlock`s and `Signal`s with
pure functions, Steward Judgment resolves personal attention into five states, and
Memory + Learning already runs an append-only belief ledger inside `steward_beliefs`.
What is missing is a layer that persists what it noticed, forms views about the
business (not just the person), proposes work, and learns whether it was right.

The proposal below adds that layer without a new source of truth and, for v1, without
a migration.

## 1. Thesis and laws

**Thesis.** The Intelligence Engine is the suite's steward: it reads broadly,
remembers what it noticed, forms a small number of honest views about business health,
proposes bounded next moves, and learns from what people did with those proposals.

Laws, inherited and extended:

1. Read broadly, write narrowly. Apps remain the systems of action. The engine writes
   only its own reasoning artefacts plus activity rows.
2. Observed / Inferred / Decided is preserved end to end. Human-decided truth outranks
   any inference; a decided belief silences a contradicting inference rather than
   debating it.
3. Nothing is asserted without evidence. Every observation, hypothesis and
   recommendation carries `EvidenceRef[]` and the context block ids it rests on.
   No evidence means the artefact is not produced.
4. Deterministic code decides *what is true and what qualifies*. The model decides
   *how to say it and what to propose*. The model never invents an entity, a date,
   a number or a name; a verification pass drops anything not present in the packet.
5. Silence is a valid, respected output. "Nothing needs you" already exists in
   Judgment and must survive at business level too.
6. Bounded volume. Caps at every stage — candidates, hypotheses shown, recommendations
   live at once. Over-notification is a defect, not a tuning issue.

## 2. Engine loop and runtime model

```text
Observe  -> deterministic scan of the SuiteSnapshot, emits Observations
Understand -> group observations into a small candidate set (business themes)
Remember -> bounded memory/context selection for those candidates only
Judge    -> deterministic qualification: does this deserve a view at all?
Reason   -> one bounded model call over an approved evidence packet -> Hypotheses
Verify   -> drop anything unsupported, cap confidence, attach evidence
Recommend-> Recommendations and ActionProposals, each routed to an owning app
Decide   -> human accepts / edits / rejects / defers
Execute  -> the owning app performs the action, not the engine
Outcome  -> observed later from canonical movement
Learn    -> outcome + decision recorded into the belief ledger, biases next reasoning
```

Runtime: **on-demand first, scheduled second.** v1 runs the loop when Pulse or Home is
opened, with a short-lived cache keyed by organization plus a snapshot fingerprint, so
repeated views are stable rather than re-rolled. A `/api/public/intelligence.sweep`
route (signature-verified, same shape as the existing public routes) lets a scheduler
run the same loop daily later. No event bus: the existing `public.activities` stream is
already the nervous system, and the fingerprint tells the engine when it changed.

## 3. Domain contracts

New file `src/domain/intelligence-engine.ts`. Everything below reuses `EntityRef`,
`EvidenceRef`, `TruthTier`, `ContextBlock`, `Signal` and `ConfidenceLevel`.

- **Observation** — a deterministic, dated read about the business rather than a
  person. `{ id, kind, subject?, statement, tier, evidence, contextRefs, at, sourceApps }`.
  Business-level counterpart to today's per-entity `ContextBlock`.
- **Hypothesis** — a possible reading of several observations.
  `{ id, theme, claim, because, confidence, observationRefs, contradicts?, status }`.
  Always inferred tier. A hypothesis with one observation cannot exceed `moderate`.
- **Recommendation** — a proposed move with a destination app.
  `{ id, hypothesisRefs, headline, rationale, kind: "move" | "campaign" | "system" | "experiment",
     destination, effort: "small" | "medium" | "large", expectedSignal, status }`.
  `expectedSignal` is what should become observably true if it worked — this is what
  makes the learning loop possible.
- **ActionProposal** — the bounded, reversible unit an app could execute:
  `{ id, recommendationId, appId, operation, payload, reversible, requiresApproval: true }`.
  v1 ships proposals only; execution is a human clicking through into the owning room.
- **Outcome** — `{ id, recommendationId, decision: "accepted" | "edited" | "rejected" | "deferred",
   editedText?, observedResult?: "signal_improved" | "no_change" | "worsened" | "unknown",
   decidedBy, at }`.

Reuse, not replace: `Signal` stays the leadership-attention shape in Pulse, and
`AttentionItem` stays the person-attention shape in Steward. Recommendations render as
signals with a new category; nothing in Pulse's contract changes.

## 4. Reasoning architecture

Four stages, each a pure module under `src/data/intelligence/engine/`:

1. **Candidate generation (deterministic).** `observe.ts` walks the snapshot for
   structural facts: count of open projects, project health distribution, pipeline
   volume by stage and age, reply latency in Comms, unresolved Roadmap decisions,
   repeated Ops blocker chains, commitment slippage rates. These are counts and dates
   only — no interpretation.
2. **Bounded context.** Reuse `memory-context.ts`'s scored selection to attach only the
   memory relevant to the candidate themes, with the same hard caps and the same
   `because` strings, and the same suppression of twice-dismissed patterns.
3. **Semantic reasoning (bounded).** One call through `src/lib/ai-gateway.server.ts`,
   using the two-step evidence-packet discipline already proven in
   `roadmap-studio.server.ts`: build an approved packet, then ask the model to express
   and connect only that packet. Strict JSON, batched, fail-closed.
4. **Verification and judgment.** `verify.ts` rejects any claim whose referenced
   observation ids are absent, any number not in the packet, any named entity not in
   the snapshot; caps confidence by evidence count and staleness; and applies the
   precedence law so a decided belief overrides a contradicting hypothesis. Survivors
   are ranked, capped, and rendered.

If the model call fails or is not configured, the engine degrades to observations plus
deterministic signals. That is the current behaviour, so nothing regresses.

## 5. Business health reasoning

The engine reasons over a small set of themes, each grounded in observations that
already exist in the snapshot:

- **No active project.** Zero projects passing `isOpenProject` while relationships and
  prospects exist → capacity is idle and revenue continuity is at risk.
- **Delayed delivery.** Projects at `at_risk` / blocked health, or milestones past
  human-set dates.
- **Weak pipeline.** Prospect count and qualified-stage volume below the trailing norm,
  with age of newest discovery.
- **Stalled follow-up.** Comms threads where `dueState` is overdue, or inbound with no
  outbound after N days.
- **Recurring blockers.** Repeated Ops chains and repeated Steward patterns sharing a
  cause across three or more distinct conversations — the existing recurring-pattern
  threshold.
- **Client risk.** Relationship silence plus an open commitment to that person, plus
  delivery friction on their project.
- **Emerging opportunity.** Repeated inbound theme in Comms or repeated prospect
  attribute in Scout not yet reflected in Roadmap.

The list is a starting vocabulary, not a rule engine: the deterministic layer only
supplies counts and dates; connecting *pipeline is thin* to *no active project* to
*Scout has qualified nobody in three weeks* is the model's job over a verified packet.

## 6. How it becomes generative without becoming random

Generativity is constrained by three rules:

- A recommendation must cite at least two observations from at least two different
  rooms, or be labelled explicitly as a single-room hunch with low confidence.
- Every recommendation declares its `expectedSignal` — a change the engine will be able
  to observe later. A proposal whose success could not be observed is not shown.
- `kind: "system"` recommendations (new app, workflow, automation) require a *repeated
  structural need*: the same friction pattern present across three or more distinct
  canonical sources, reusing the recurring-pattern threshold already in
  `src/data/steward/learning.ts`. This is what lets it say "you keep re-explaining the
  same onboarding steps; a lightweight intake app would remove it" without inventing
  product ideas out of boredom.

App-idea proposals render as a Roadmap-destined recommendation, since Roadmap already
owns sequencing and Studio already owns expression.

## 7. Learning loop

Every human decision on a recommendation writes an `Outcome`, encoded into the existing
append-only belief ledger through the reserved `steward-memory::` payload prefix (the
mechanism `memory-encoding.ts` already defines), with a new meta kind. Effects:

- **Rejected** twice for the same `patternKey` → that theme is suppressed from future
  candidate generation for the organization, exactly as dismissed memory patterns are.
- **Edited** → the human wording becomes a decided belief and is fed to the interpreter
  as precedent, so the next phrasing follows the correction.
- **Accepted** → the engine watches `expectedSignal`. If the underlying observation
  improves within the window, the theme's prior confidence rises; if it worsens or does
  nothing, it falls. Confidence is derived from this record, never typed in.
- All outcomes are org-scoped, append-only and reversible by superseding, so no
  learning step can silently destroy prior truth.

## 8. Action boundary

- **Automatic, no approval:** read; derive; write its own reasoning artefacts; record
  activity rows describing what it noticed.
- **Requires explicit human approval:** any `ActionProposal` — drafting outreach,
  changing a project state, creating a roadmap item, opening a campaign. v1 approval
  means "the human opens the owning room and does it"; the engine only pre-fills.
- **Human-only, never proposed for automation:** sending anything to a client,
  committing on someone's behalf, setting a deadline for another person, changing
  pricing or scope, and any destructive or irreversible operation.

## 9. Where it lives, and schema

- `src/domain/intelligence-engine.ts` — contracts.
- `src/data/intelligence/engine/{observe,hypothesise,recommend,verify,learn}.ts` — pure logic.
- `src/data/intelligence/service.ts` — extended with `engine.read(organizationId)`;
  `loadSuiteSnapshot` is reused unchanged, so RLS and org boundaries stay as they are.
- `src/routes/api/public/intelligence.reason.ts` — the single bounded model call,
  auth-verified and fail-closed like the Steward interpret route.
- Surfaces: Pulse gains a business-health lead section above today's signal list; Home's
  Today panel gains at most one recommendation.

**No migration for v1.** Observations and hypotheses are derived on read; outcomes and
learned priors ride the existing `steward_beliefs` ledger; activity rows use the
existing `public.activities` contract. A dedicated `intelligence_recommendations` table
becomes worth proposing only when recommendations must persist across sessions with
their own lifecycle — that will be reported as a proposed migration, not applied.

## 10. Minimal v1 sequence

1. Contracts + `observe.ts` with the seven business themes; unit-tested, no model.
2. Pulse business-health section rendering deterministic observations. Visible life on
   day one, and honest without any AI.
3. `intelligence.reason` route + evidence packet + verification; hypotheses appear with
   evidence and confidence.
4. Recommendations with destinations and `expectedSignal`; accept / edit / reject
   controls reusing the Steward feedback components.
5. Outcome recording and suppression; confidence priors from accepted outcomes.
6. `kind: "system"` proposals gated behind the recurring-structural-need threshold.

## 11. Acceptance tests (proving reasoning, not matching)

- **Connection test:** a fixture with thin pipeline + zero active projects + a stale
  Comms thread must yield one connected reading, not three separate rule hits.
- **Novel-shape test:** a fixture whose combination was never hand-coded still produces
  a grounded, evidence-cited hypothesis.
- **Fabrication test:** a packet without a revenue figure must never produce a claim
  containing one; the verifier drops it and the test asserts the drop.
- **Precedence test:** a decided human belief contradicting a hypothesis suppresses it.
- **Silence test:** a healthy fixture produces zero recommendations and says so.
- **Suppression test:** two rejections of the same pattern remove it from the next read.
- **Isolation test:** organization A's observations never appear in organization B's read.
- **Determinism test:** the deterministic stages produce byte-identical output for the
  same snapshot.

## 12. Risks and mitigations

- **False urgency** — no urgency language without a human-set date; caps on shown items;
  "nothing needs you" preserved at business level.
- **Over-notification** — hard caps, suppression on rejection, one recommendation
  maximum on Home.
- **Confirmation bias** — hypotheses must record `contradicts`; the packet includes
  disconfirming observations, and confidence falls when accepted advice did not move
  the expected signal.
- **Hallucinated causality** — claims are phrased as readings with evidence, never as
  proven cause; multi-room citation required for anything actionable.
- **AI micromanagement** — the engine never addresses individual performance; it reasons
  about the business, and person-level attention stays in Steward Judgment where the
  restraint laws already live.
- **Model unavailability** — deterministic degradation, never a blank or invented screen.
