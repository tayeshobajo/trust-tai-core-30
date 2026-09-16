# Comms reviewer extension: the strategic judgment gate (S01-S07)

Added 16 September 2026. This is an **extension** to the Comms reviewer. It
does not change, rename or retire any meaning in `docs/comms-review-acceptance.md`
(C01-C22) or the T01-T05 and P1-P8 records. The states used here mean exactly
what they mean in that file: Verified, Implemented, Partly implemented,
Mockup only, Unmet. Code evidence is not live evaluation.

## Why this exists

Two real operating misses showed that the reviewer was checking writing
without first asking what kind of moment it was in.

1. A teammate's client follow-up said, in effect, "Tai will also walk you
   through the estimated build time, pricing, and finalize the details." It
   was polite, and it quietly made Tai sound like a downstream person the
   client was being passed to, when Tai was leading the relationship.
2. A direct Upwork invitation for a public sector contract was answered with
   the ordinary rate, with nothing recorded about scope, procurement burden,
   reporting, staffing, duration, payment cycle, platform fees, risk or
   margin. The mistake was not the number. The mistake was that no decision
   was made.

## The law this adds

Before judging wording, the reviewer asks: what kind of moment is this, what
matters here, and what decision are we about to make. Then it reviews the
words against that understanding. The surface does not change: the same Must
fix, Consider and Note findings, the same approval readiness. No dashboard, no
score, no badge, no new tab.

## The criteria

| ID | Criterion |
| --- | --- |
| S01 | Judgment order is explicit in the reviewer instructions: context and obligations, kind of moment, relationship ownership, commercial judgment, then wording, with future opportunities kept private. Hidden working is never surfaced. |
| S02 | Relationship continuity: where the packet shows one person leading the strategy and the relationship, wording that makes them sound newly introduced, detached or merely downstream is a must_fix `relationship` finding in a client-facing draft, explained by its relationship effect rather than by a rule against third-person mentions. |
| S03 | Relationship restraint: no message is forced to name the person leading, no teammate's message is rewritten as though somebody else wrote it, actual sender identity still wins, and no lead is inferred where the packet does not show one. Unknown stays unknown. |
| S04 | Commercial judgment: where the packet reads as non-routine and the outgoing draft commits a price, rate, fee, discount or payment term with no evidence the implications were weighed, a must_fix `commercial` finding quotes the exact outgoing commercial words, names the source evidence, and says a human commercial review is required before approval. |
| S05 | Commercial restraint: the finding never states or implies what to charge, never invents a market rate, budget, benchmark or premium, and never treats public sector work as automatically worth more. An acknowledgement with no commitment raises nothing, and routine repeat work on terms the packet shows as already agreed raises nothing. |
| S06 | Separation: relationship and commercial risks are ordinary findings because they affect whether THIS draft is fit to send. The private `opportunities` output keeps its existing meaning under law 11: future work only, never changing the current draft. |
| S07 | Approval readiness is unchanged and still blocks while any must_fix finding is open, including these two kinds. Nothing here sends anything. |

## How it is built

- `src/domain/comms-strategic-gate.ts` is the deterministic floor: pure
  functions over the packet that return at most one relationship finding and
  one commercial finding, each quoting words that are really in the draft.
- `src/lib/comms-review.server.ts` carries the same judgment in laws 12 and 13
  of `REVIEW_INSTRUCTIONS`, with the judgment order stated before the laws.
  After the model answers, the gate is applied and adds a finding only where
  the model did not already raise that kind as a must fix.
- Finding kinds `relationship` and `commercial` are additive. The kind column
  is free text, so older findings and older runs are unaffected.
- Prompt version bumped to `comms-review/2026-09-16-strategic`, so runs made
  under the old instructions are never mistaken for this reviewer.

## Evidence

| ID | State | Evidence |
| --- | --- | --- |
| S01 | Implemented | `src/domain/comms-review-eval.test.ts`, order and law text asserted. CODE. |
| S02 | Implemented | `src/domain/comms-strategic-gate.test.ts`, handoff case. CODE. |
| S03 | Implemented | Same file: no lead evidence, author's own step, ordinary mention. CODE. |
| S04 | Implemented | Same file: invited public sector rate, and unapproved concession. CODE. |
| S05 | Implemented | Same file: acknowledgement only, routine repeat work, and the assertion that no finding text says premium, too low or charge more. CODE. |
| S06 | Implemented | Gate returns findings only; law 11 text unchanged and still asserted. CODE. |
| S07 | Verified previously | `approvalReadiness` in `src/domain/comms-review.ts` is untouched and already blocks on any open must fix. CODE. |

Model evaluation cases matching the five scenarios are written into
`src/domain/comms-review-eval.ts` as `relationship_handoff`,
`invited_public_sector_default_rate`, `public_sector_acknowledgement_only`,
`routine_repeat_work` and `unapproved_concession`. They are written down, not
yet run against a live provider.

## Not proved

- MODEL: no live provider run of the five new evaluation cases.
- LIVE: no signed-in run of the reviewer with these findings on real records.
- TAI: no acceptance of the wording or the judgment by Tai.

Nothing was published, sent or applied to the database for this change.
