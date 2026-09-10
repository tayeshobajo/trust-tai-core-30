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

## The write path

`src/data/supabase/commercial-service.ts` is the only place commercial state is
written. It uses the authenticated client, so RLS applies as the signed-in
person and the organization boundary is enforced by the database. No
service-role key touches a commercial path.

| Function | What it does |
| --- | --- |
| `setClientCommercialState()` | Writes only the facts it is given onto the canonical client row, stamps actor, time and reason into `commercial_provenance`, and emits `client.tier_changed` exactly once when the tier actually moves. A change into Build carries the human-entered phase amount; every other tier carries none |
| `recordProposalSent()` / `recordProposalOutcome()` | Proposal state on the existing roadmap lineage node, plus `proposal.sent`, `proposal.signed` or `proposal.declined`. A declined proposal recognises nothing |
| `setMeetingKind()`, `logTouch({ meetingKind })` | A person says what a meeting was, and the record keeps who said so and when |
| `readOrganizationWeeklyTargets()` / `saveOrganizationWeeklyTargets()` | Configuration only, admin write enforced by RLS, defaults when an organization has no row |
| `readWeeklyScoreboard()` | The whole week derived at read time: Run from tier state, Diagnose from signed proposals dated in the week, Build from `client.tier_changed` events dated in the week, plus discovery calls, roadmap reviews, first touches and proposals sent. Nothing it computes is written back |

## Not in this slice

No commercial UI and no backfill. The migration is applied in production and the
service is wired and tested, but no tier, MRR, proposal amount or meeting kind
has been written, because every one of those is a human entry and this project
does not invent them.


## The week belongs to the organization

The business week runs Monday 00:00 to the next Monday 00:00 in the
organization's own timezone, not the server's. `src/domain/business-week.ts`
takes an instant plus an IANA timezone and returns the UTC instants that bound
that local week, so a database comparison stays exact through both daylight
saving transitions: the spring week is 167 hours long and the autumn week 169.

`readWeeklyScoreboard()` reads `organizations.timezone` as the canonical
setting. If it is missing or not a real timezone, the week falls back to UTC and
the scoreboard says so explicitly through `timeZoneFallback` and
`timeZoneBecause`. It never quietly uses whatever timezone the server happens to
run in. Trust Tai is `America/Chicago`.

## A first touch is a first outreach

A first touch is the first time a person at Trust Tai reached out to a
relationship, over a channel a human actually uses: email, call, meeting,
message, LinkedIn or text. Inbound contact is not a first touch, and neither is
anything imported or generated by a system rather than sent by a person. Earlier
inbound contact does not disqualify a later first outreach. Earlier outbound does.
Several outbound touches to the same relationship in one week count once. The
rule lives in `src/domain/first-touch.ts` and the channel list is the one place
to extend when a new human channel, such as a voice note, becomes real.

## Unknown is not zero

The weekly scoreboard reports each source separately. A table that is genuinely
empty is a real 0. A query that failed is unknown, and its number is absent
rather than zero, so a screen can say it does not know instead of quietly
reporting a bad week. Every other source that did answer keeps its real value.

## Once means once

A commercial fact is a transition, not a button press. Recording the same
proposal send again replays the existing state and emits nothing further.
Recording the same outcome again replays it. A proposal already answered cannot
be reopened or reanswered by this system, because no such correction exists in
the canon and allowing it would move recognised money between weeks. Moving a
client into Build without a human-entered phase amount is refused before the
client row is touched.
