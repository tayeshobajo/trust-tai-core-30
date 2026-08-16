# Conductor V3 — Factory execution coverage and learning

V2 proved that a person can approve part of a cross-room plan and have only the
approved part reach the owning room. V3 does two further things, and nothing
more: it extends safe execution into Scout and Roadmap, and it closes the loop
so the system can find out what actually happened and learn something modest
and honest from it.

The V2 laws are unchanged. The Conductor coordinates. Steward interprets. Owning
rooms execute. Human decisions are authoritative. Approval is not execution.
Routing is not completion. No adapter means no execution claim.

## The six V3 laws

1. **Execution coverage is explicit, never implied.** Every operation appears in
   the capability registry as supported or unsupported, with a reason.
2. **Observation is not causation.** A result seen after an action is an
   association until the evidence says otherwise.
3. **One result is not a rule.** A single outcome is an observation. Three
   consistent ones may become a low-authority pattern.
4. **Learning never expands authority.** No lesson makes an unsupported
   operation routable or removes an approval requirement.
5. **Human corrections outrank inferred learning.** A decided lesson supersedes
   an inferred one and inference cannot overturn it afterwards.
6. **The system improves judgment from outcomes, not by rewriting business
   truth.** Learning lives in its own ledger; it never edits a room's records.

## What can actually execute now

| Room | Operation | Adapter boundary | Claimable state |
| --- | --- | --- | --- |
| Comms | `comms.draft_reply` | `commsService.saveDraft` | routed |
| Projects | `projects.record_blocker` | `projectsService.update` | routed |
| Scout | `scout.start_discovery_run` | `scoutService.discover` | routed |
| Scout | `scout.record_fit_correction` | `scoutService.feedback` | routed |
| Roadmap | `roadmap.create_shell` | `roadmapService.create` | routed |
| Roadmap | `roadmap.request_decision` | `roadmapService.addDecision` | routed |

Every one of these is consequential and requires approval. No adapter claims a
state past `routed`; anything further has to be observed from the owning room.

Deliberately non-routable, and named as such in the registry:
sending anything to a prospect or client, resolving a Roadmap decision, changing
approved sequencing, publishing Studio work, routing Ops work without a person,
and anything touching money, pricing or commitments.

## The loop

```text
recommended → proposed → approved → routed → accepted → executing
   → completed → observed → measured → learned
```

Any step may stop at an honest interruption: held, rejected, withdrawn,
refused, non-routable, inconclusive, or not measurable. Nothing is pushed
forward that the owning room cannot prove.

## Observation

`outcome-observer.ts` asks the owning room's own service whether the expected
signal is there — a draft in Comms, a blocker on the project, a discovery run
in Scout's history, an open question on the roadmap. Results are classified
`signal_present`, `signal_absent`, `partial`, or `not_measurable`, with a truth
class of `observed`, `decided`, `inferred`, `recommended` or `unknown`.

When a room cannot answer, the result is `not_measurable` with `unknown`
confidence. No measurement is ever invented.

## Learning

`conductor_learning` is append-only and organization-scoped, the same shape of
ledger as `steward_beliefs`. A record carries the hypothesis, the expected
signal, the observed result, evidence references, confidence, the lesson in
plain language, its authority basis, and what it supersedes.

Deterministic rules:

- fewer than three consistent observations → an observation, low confidence,
  `isRule: false`
- three or more consistent → `moderate`; five or more → `high`
- contradictory evidence → confidence drops and the lesson says "mixed results"
- a human correction is recorded with basis `decided` and supersedes the prior
  inferred record; later inference on the same scope is refused
- lessons are phrased as association unless causal evidence exists
- `grantsAuthority` is always false

Recall is bounded: reasoning packets receive only the lessons scoped to the
rooms in play, with provenance attached, never the whole history.

## Metrics

Output (discovery runs, drafts written), leading (replies, meetings, decisions
requested), and lagging (delivery, revenue) are distinct classes. Volume is
never reported as business health.

## Schema

`docs/conductor-v3-schema.sql` adds `conductor_observations` and
`conductor_learning`. Both are additive, organization-scoped, RLS-enabled,
fail-closed, insert-and-select only, with no delete grant. Apply it to the
Supabase project before the persistence layer can record live outcomes.
