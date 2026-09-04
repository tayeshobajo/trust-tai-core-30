# Trust Tai OS, production plan

This is the canonical route to production. `docs/architecture-canon.md` remains the
higher authority on law; where this file and the canon disagree, the canon wins.
The previous `.lovable/plan.md` is stale and is not an implementation plan.

Live execution status lives in `roadmap.md`.

## North Star

**Run the week. Open a client. Move what matters. Prove it worked.**

## Two mental models, and only two

1. **Run the business this week**: Home, Scout, Comms, Pulse, Approvals.
2. **Understand one company**: Clients, then Overview, Roadmap, Projects,
   Relationship, Site, Files.

Nothing else may be invented as a third way to think about the product.

## Navigation target

Ordinary top-level: Home, Clients, Scout, Comms, Website, Ops, Studio, Pulse,
Conductor, Approvals, Steward. Settings is secondary.

Roadmap and Projects remain real business rooms: they own state, permissions,
canonical routes, event ownership and deep links. They leave ordinary top-level
navigation only once the Clients shell is production ready. Leaving the nav is a
navigation change, never a demotion of ownership.

**Clients is Core. Clients owns no business state.** It composes and read-projects
from the owning rooms. Building a new architecture layer under Clients is forbidden
unless the canon is deliberately changed first.

## Immutable laws

- Apps own state. Core owns identity. The event stream owns history. Steward owns
  interpretation. Pulse owns visibility.
- Small input. Deep intelligence. Clear output.
- Familiar on the surface. Exceptional underneath.
- Attempted != Executed != Verified != Human Accepted.
- Approved != Executed != Verified.
- Agents prepare. Humans approve. Execution happens after approval.
- Rooms run the week. Clients explain the company.
- Never make Tai choose between the system and getting the work done. Every
  critical workflow keeps a manual canonical path, with provenance.
- 60% fit triggers research, not outreach. No person, no first message. The brief
  gates drafting. Urgency is never manufactured. The ask gate holds. Drafting fails
  honestly. Human approval precedes any send. Text is protected. Comms surfaces a
  reason and never manufactures one.

### Internal operating loop

Watch, Reach, Relate, Diagnose, Build, Run, Keep, Tell.

Governing rule: **every station produces the truthful condition the next station
needs. Work may enter wherever truthful readiness already exists. No room fabricates
readiness merely to move work forward.** There is no rule that work must pass
through every station.

### No-surprise-feature rule

No new room, tab, status, dashboard, chart, agent, automation, health score, send
behaviour or approval behaviour without an explicit design decision. When a need
appears: stop, document it, recommend, wait.

## Commercial definitions, locked

Weekly targets: first touches 10 to 12; discovery calls 2 to 3; Diagnose proposals
sent 1 to 2 with roughly 2 signed a month; 20 active Run clients; revenue about
$21k a week.

Revenue:

- Run weekly = `mrr x 12 / 52`, derived at read time from cents, rounded for display
  only. Never divide by 4 or 4.345. Never persist a weekly revenue number.
- Diagnose is recognised in full in the week of `proposal.signed`, at the proposal
  amount.
- Build is recognised in full in the week of `client.tier_changed -> build`, at the
  human-entered phase amount.
- One-off revenue is an event. Recurring revenue is state.
- A signed proposal never inflates Run until the tier actually changes to Run.

Discovery:

- A logged meeting carries `meeting_kind` of `discovery`, `roadmap_review`,
  `delivery` or `other`. Default is none.
- Human-set only.
- A discovery call counts only when `meeting_kind = discovery` and `occurred_at` is
  in the past.
- Never inferred from a calendar entry, a title, Fathom, or a transcript.
- `roadmap_review` is what satisfies review cadence and `next_review_at`.

**Review coverage is not retention.** It is called Review coverage until a real
renewal and churn denominator exists.

## Measurement law

There is no single loose Point B number. A milestone outcome metric carries an
identity or key, a label, a unit, a direction of `increase | decrease | maintain`, a
baseline value with its date, and a target value with its date. A measurement
references the metric and carries a value, `measured_at`, a source, provenance and
`recorded_by`. No composite health score in v1, in any room.

## Manual override law

Tai must be able to do all of the following by hand, through the same canonical
services and with the same provenance as any automated path. Manual data is never
second class and is never labelled as lesser.

Create a client. Edit commercial state. Create a roadmap. Create a milestone. Record
Point A. Set Point B. Record a measurement. Create or hand off a project. Log a
relationship touch. Log a discovery call. Log a roadmap review. Add a company to the
Scout watchlist. Enter a proposal. Change a tier. Record a renewal. Create a content
request. Approve work.

## Room outcomes

**Home**: "Are we on pace this week?" Today plus four This Week numbers. No charts,
no percentages. Today ordering: an existing obligation at risk, then a floor breach,
then a decision opportunity.

**Clients**: the client book. A grid with fixed hierarchy: company; tier and value;
next review or renewal; delivery status. Proposed companies are muted and separate.
Add Client is manual and required.

**Client page**: Overview, Roadmap, Projects, Relationship, Site, Files. No Tasks tab
and no Milestones tab. The client page owns nothing; it reads the owning rooms.

**Scout**: "Who can I truthfully reach today?" Outcome first. Views: Ready, Movement,
Needs a person, All, plus Watchlist and Settings. Fit is supporting evidence only. A
person plus a governed brief is the gate. Observed and Inferred are explicit.
Sentinel is curated only.

**Comms**: "Who has given us a real reason to write?" Quiet is not risk. At risk means
only a reply owed, a promise open, or a dated reason unacted. Judgment comes before a
draft. Grounding is shown. Voice note and `meeting_kind` are manual logging. No
cadence language anywhere.

**Roadmap**: "Where are we taking this company, and is it working?" Point A to Point
B, outcomes not deliverables, manual roadmap, milestone and measurement paths, a
one-line delivery projection from Projects, decisions displayed from Approvals. No
composite Roadmap Health in v1.

**Projects**: "Is the promised work getting done?" Owns tasks, delivery, artifacts,
blockers and acceptance.

**Pulse**: "What deserves a decision right now, and in which room?" Canon groups only:
Act now, Evaluate, Watch closely, Good to know. No Momentum slipping and no On track
group. Same snapshot as Home. Feedback: Accept, Not now, Not useful, Why am I seeing
this?

**Approvals**: one place to decide. Rooms display state and a link only, never a
duplicate decision control.

**Studio**: "What did we learn that is worth telling?" The existing HIT, approval and
publish laws are unchanged.

## Brand contract and anti-drift

Source of truth: the official Trust Tai mark, royal `#1D54C1`, Sora, Manrope and
JetBrains Mono, and the tagline **"You carry the vision. I build the system that runs
it."** No gold T, no invented slogans, no hardcoded personal Tai quotes in generic UI,
no room-specific redesign language. `src/brand/brand-contract.ts` is the machine
readable form and its tests are the guard.

Every implementation slice is compared against the approved mockup or reference on
five axes:

1. Information hierarchy
2. Density
3. Vocabulary
4. Ownership
5. Familiarity

## Verification vocabulary, exact

| Level | Meaning |
| --- | --- |
| Not started | No code, no schema, no decision |
| Implemented | Code exists in the repository |
| Code/Test Verified | Typecheck and the test suite cover it and pass |
| Runtime Verified | Observed working in a running app against real data |
| Production Verified | Observed working in the production environment |
| Human Accepted | Tai has used it and accepted it |

Lovable saying "done" is at most **Implemented** until independent evidence exists.

## Captain slice protocol

Every slice runs: Read, Define, Implement, Inspect, Test, Runtime verify, Production
verify, Mockup compare, Report, Human gate. A slice is not finished at Implement.

## Phases

### P0, prove the existing build

Exit acceptance, all nine:

- People and activity schema, production proof
- Approvals schema, production proof
- Invite email end to end (**human gate**)
- Gmail send re-consent plus one real governed reply (**human gate**)
- Add-to-Comms production proof
- Content image bucket exists and is public
- Publish endpoint configured
- One controlled article published and independently verified (**human gate**)
- Paperclip bridge verified

Agents remain paused throughout P0.

### P1, commercial truth

Client commercial state (tier, mrr in cents, engagement dates), proposals with sent
and signed events, tier change events, provenance on every change, weekly targets
stored at org level, revenue derived at read time by the locked rules. Exit: the six
weekly numbers are derivable from real rows, with no persisted weekly revenue.

### P2, Clients and Home

The Clients book and the client page shell composing owning rooms. Home answers "are
we on pace this week?" from derived data only, with Today above four This Week
numbers. Exit: launch statements 1, 2 and 9 hold.

### P3, Roadmap and Projects handoff

Point A, Point B, milestone metrics with baseline and target, measurements with
provenance, manual creation paths, and a truthful one-line delivery projection from
Projects on the roadmap. Exit: launch statements 3 and 10 hold for one real client.

### P4, Scout and Sentinel

Watchlist curated to a bounded list, a bounded scheduled sweep, refresh in place,
Movement only on observed evidence change, coverage as counts. Exit: launch statement
4 holds and the board stays quiet when nothing moved.

### P5, Comms

Real reason to write, judgment before draft, grounding shown, voice note and
`meeting_kind` manual logging, first touch counted. Exit: launch statement 5 holds and
every existing Comms law test is unchanged and passing.

### P6, Pulse

Canon groups only, deterministic momentum floors that never override a gate, the same
snapshot as Home, the existing feedback contract. Exit: launch statement 6 holds.

### P7, Keep

Review coverage, `next_review_at` satisfied by `roadmap_review`, renewal recorded by
hand, retention language withheld until a real denominator exists. Exit: launch
statements 7 and 8 hold.

**Core production readiness is P0 through P7.** Launch does not require P8 or P9.

### P8, Tell

Studio content engine through to a verified published article and a measured effect.
Post-launch expansion.

### P9, Intelligence expansion

Conductor, Steward interpretation depth, canon governance, further agents. Post-launch
expansion. Nothing here may be counted inside launch readiness.

## Agent production policy

Initial candidates, only after the owning room reaches production acceptance:
Sentinel, Scribe, Herald. Watchman and Ledger are deferred as duplicative. Engineer is
deferred as higher risk. **A live Paperclip bridge is not live agents.** Every agent
stays paused until its specific capability gate passes.

## The ten launch statements

1. I can open Home and know whether the business is on pace.
2. I can open Clients and immediately know who needs us.
3. I can open one client and understand where we are taking them, whether delivery is
   moving, and whether the outcome is changing.
4. I can open Scout and know who is genuinely ready for a first touch.
5. I can open Comms and know who has given me a real reason to write.
6. I can open Pulse and trust that anything under Act now genuinely deserves it.
7. I can manually create the truth when the system does not already know it.
8. I can see what an agent proposed and know nothing consequential happened without a
   person.
9. I never have to remember where a client's information lives.
10. The system can show that Trust Tai's work changed something measurable.

## Progress accounting

Two numbers, both computed in `roadmap.md`.

- **Production Readiness %** covers P0 to P7 only.
- **Full Engine %** covers P0 to P9.

Rules that stop the number being gamed:

1. Each phase has a fixed weight. Each phase weight is divided equally across that
   phase's listed exit gates.
2. A gate earns its share only at its **required verification level**, which is stated
   next to the gate. Implemented alone never earns a share.
3. A phase is only marked complete, and only receives its full weight plus its "phase
   complete" flag, when every one of its gates is met.
4. A gate marked **human gate** cannot be counted until Tai has accepted it. No
   simulation, no inference, no assuming.
5. Removing or rewording a gate to raise the number is a charter change and must be
   recorded here first.

Phase weights:

| Phase | Production Readiness weight | Full Engine weight |
| --- | --- | --- |
| P0 | 12 | 10 |
| P1 | 12 | 10 |
| P2 | 16 | 14 |
| P3 | 12 | 10 |
| P4 | 12 | 10 |
| P5 | 14 | 12 |
| P6 | 10 | 8 |
| P7 | 12 | 10 |
| P8 | n/a | 8 |
| P9 | n/a | 8 |
| Total | 100 | 100 |
