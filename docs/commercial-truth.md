# Commercial truth, P1 foundation

The rule this layer exists to protect: **one-off revenue is an event, recurring
revenue is state.** Nothing derived is ever written down.

## Where each fact lives

| Fact | Home | Why not somewhere new |
| --- | --- | --- |
| Tier, MRR, renewal, next review | `public.clients` | The client record is already the canonical company. A second commercial table would be a second truth |
| A proposal | `public.roadmaps` | The roadmap already carries `prospect_id`, `relationship_id` and `client_id`, so it is the lineage node. There is no deal object and no second pipeline |
| The kind of a meeting | `public.comms_touches.meeting_kind` | The touch is already the canonical logged interaction |
| What a good week looks like | `public.organization_weekly_targets` | Configuration, org scoped, admin written. Never holds an actual |

Migration: `docs/commercial-truth-schema.sql`. Additive, idempotent, every new
column nullable, no seeds, RLS on the new table using the existing
`private.is_org_member` and `private.is_org_admin` helpers.

## Derivation law

`src/domain/revenue.ts`, pure and tested:

- Run weekly = `mrr_cents * 12 / 52`, at read time. Never `/ 4`, never `/ 4.345`,
  never stored, rounded only at the display boundary.
- Diagnose is recognised in full in the week of `proposal.signed`, at the
  proposal amount.
- Build is recognised in full in the week of `client.tier_changed -> build`, at
  the human-entered phase amount.
- Run reads tier state only. A signed proposal cannot inflate Run until the
  tier actually becomes Run.
- A week is Monday 00:00 UTC to the next Monday, exclusive.

`src/domain/discovery.ts`: a discovery call counts only when a person set
`meeting_kind = discovery` and the meeting has already happened. A scheduled
meeting is a plan. A withdrawn record makes no claim. `roadmap_review` is a
different thing and satisfies review cadence instead.

## Events

Added to the shared vocabulary in `src/domain/events.ts`, all emitted by
Roadmap because Roadmap owns the prospect -> roadmap commercial lineage:

- `proposal.sent`, `proposal.signed`, `proposal.declined`
- `client.tier_changed`, carrying the human-entered phase amount when the new
  tier is Build

Every amount is human-entered. Nothing here reads a document, a transcript or a
model output to decide money.

## Not in this slice

No commercial UI, no writes, no backfill, no seeded rows, and the migration has
not been applied to production. Applying it is the next step; until an actual
production write and read-back exists, these gates stay Code/Test Verified.
