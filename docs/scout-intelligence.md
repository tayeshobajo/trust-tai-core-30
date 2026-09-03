# Scout intelligence & decision layer

Scout's job is to answer one question honestly: *should we approach this company,
who do we speak to, and why now?* Everything below exists to make that answer
evidence-backed rather than confident-sounding.

## Separation of tiers

Every statement Scout shows carries a tier:

- **Fact**, observed on the company's own public pages, with a source link.
- **Inference**. Scout's reading of those facts. Always labelled.
- **Decision**, a human's call. Never generated.

Absence is reported as absence. A missing buying signal lowers *timing* to
"unknown", it never counts against the company.

## Six decision metrics

`src/data/scout-intel.ts` computes six independent reads, each with its own
"because" line:

| Metric | Weight | Reads |
| --- | --- | --- |
| ICP match | 30% | deterministic evaluator score against the active ICP |
| Opportunity readiness | 20% | digital opportunities with stated evidence |
| Evidence confidence | 20% | how much was actually observed, and how recently |
| Reachability | 15% | best contact route on record, verified beating found |
| Timing | 15% | buying signals, discounted as they age |
| Research coverage |, | how completely the company has been looked at |

The weighted result is the **priority** score. A company that was never
researched has no priority at all: `null` sorts last on the board, it is never
scored as a zero.

## People

`src/data/person-priority.ts` ranks contacts by seniority, route quality and
confidence, then names one person to approach first and states the gap that is
holding the approach back (no decision maker known, email unverified, and so
on). Scout never fabricates an address; when no provider is connected it says
"not connected".

## Account brief

`src/data/account-brief.ts` composes the outreach brief from the same evidence,
tagging each section and carrying source links through. If nothing honest was
observed, the brief says there is no hook rather than inventing one.

## Gaps

`src/data/scout-gaps.ts` turns silence into a task list, marking which gaps
Scout can close itself and which need a person or a connected provider.

## History

Every scored pass, discovery *and* website research, is written to
`prospect_evaluations`, so fit over time is auditable rather than only visible
as the latest number on the row.

## Relationship development reads

Scout's intelligence layer feeds a governed relationship-development read
(`src/data/relationship-development.ts`), held to the locked doctrine in
`docs/scout-v1.md`:

- 60% fit triggers deeper research, never outreach. Eligibility additionally
  requires a traceable founder or decision maker; a company with no person is
  never presented as ready for relationship development.
- Eligibility prepares a Relationship Development Brief, research only, from
  public professional evidence, bounded and idempotent
  (`planRelationshipPreparation`), with provenance and freshness stored on the
  prospect's `metadata.relationship_development.research` marker.
- Text is protected: recommended only on explicit text-route evidence, never
  from meeting someone, an introduction, or a found number.
- Roadmap recognition elsewhere in the suite reads counterparty-authored
  evidence only; our own language can never manufacture a signal.
