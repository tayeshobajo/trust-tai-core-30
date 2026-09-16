# Trust Tai agency journey contract

The one path a company travels from sourced to cared for, and the shared rules every
room obeys while handing work along it. The enforceable form of this document is
`src/domain/agency-journey.ts`; the synthetic fixture every round tests against is
`src/data/fixtures/agency-journey-fixture.ts`.

This document changes nothing about ownership. Apps own state. Core owns identity.
The event stream owns history. Steward interprets. Pulse shows. Conductor routes.
No new CRM, approval queue or business-data store is introduced by this contract.

## 1. The journey (A1.1)

| Stage | Owning room | Inputs | Owned state | Outcome | Decision owner | Hands to |
| --- | --- | --- | --- | --- | --- | --- |
| Source | Scout | ICP profile, a company name or website | prospects, fit evidence, sourcing activity | A company on record with where it came from | Whoever curates Scout | Qualify |
| Qualify | Scout | prospect, observed evidence | prospect status, fit read, route-to-Comms record | A judged fit with the reason written down | Whoever curates Scout | Discovery |
| Discovery | Comms | qualified prospect, a contactable person | relationships, conversations, promises, meetings | A two-way conversation with the real need on record | Relationship owner | Roadmap |
| Roadmap | Roadmap | relationship with recorded need, Point A facts | roadmaps, milestones, sequencing, approval state | An approved path from Point A to Point B | Roadmap approver | Proposal |
| Proposal | Comms | approved milestones, human-entered commercial truth | proposal drafts, versions, review findings | An approved proposal, sent only by a person | Tai or a named approver | Agreement |
| Agreement and onboarding | Clients | approved proposal, recorded acceptance | client record, tier, commercial truth, onboarding | A client on the book with an owner and agreed scope | Tai | Delivery |
| Delivery | Projects | client, approved milestone | projects, delivery state, routed work, acceptance | Work shipped and accepted | Project owner | Care |
| Care and outcome review | Clients | accepted delivery, measured outcome | review cadence, health, renewal and growth notes | A reviewed outcome, then growth or an honest close | Client owner | — |

**Off-path routes.** Anything active may become **lost** or **deferred**, and anything
lost or deferred may be **reopened** at the stage it left. Nothing else is allowed:
an item cannot slide from lost to deferred, and reopening never rewrites the history
of why it stopped. `canChangePath` enforces this.

## 2. Handoffs (A1.2)

A handoff carries ids, never copies. Three rules are enforced in code:

1. **Ids survive.** `idsSurvive(before, after)` refuses a receiving subject that lost
   the organization, a company id, a person id, or the original `sourceRef`. Gaining
   ids as the item matures (prospect gains a relationship, then a client) is normal.
2. **Idempotent key.** `handoffKey` is
   `organizationId::from->to::company|person::sourceRef`. The same step for the same
   company always produces the same key, so a retried handoff updates one record
   instead of creating a second.
3. **Owning-service writes and no false completion.** `owningApp` must equal the
   receiving stage's owning room, and a handoff is `complete` only in state
   `confirmed` **with** a `receiptRef` returned by that room. A prepared or written
   handoff reports `prepared, not written` / `written, not confirmed`. A confirmation
   without a receipt is refused, so a partial handoff can never read as done.

Moves into **agreement** and **delivery** additionally require a named human decision.

## 3. Every open item (A1.3)

`itemReadiness` answers four questions for anything still open:

- **Owner**: assigned, or the visible state `Unassigned`. Never hidden, never guessed.
- **Next action**: recorded, or the blocking reason instead. An item with neither is
  flagged as a contract break.
- **Evidence**: at least one fact, inference or decision on record.
- **Due date**: allowed only with `dueDecidedBy`. A date nobody authorised is flagged.

## 4. Capability inventory (A1.4)

Classified by reading the code in this repository on 2026-09-16, not by trusting older
v1 documents. "Working" here means there is a live Supabase-backed service plus a route;
it is **not** a claim of authenticated live verification.

| Capability | State | Evidence in repo | Real dependency |
| --- | --- | --- | --- |
| Sourcing and qualifying | working | `src/data/supabase/scout-service.ts`, `scout-discovery.ts`, `/modules/scout` | `prospects`, `icp_profiles`, `activities` |
| Scout live internet sourcing | missing | preview/mocked by standing project rule | a real sourcing integration |
| Scout to Comms handoff | working | `src/data/supabase/comms-handoff-receiver.ts`, `src/domain/comms-handoff.ts` | `comms_relationships` |
| Comms relationships, threads, drafts | working | `src/data/supabase/comms-service.ts`, `comms-messages.ts`, `/modules/comms/*` | `comms_*` tables, Gmail label scope |
| Comms AI review and versions | working, acceptance open | `src/lib/comms-review.server.ts`, `docs/comms-closure-progress.md` | `comms_review_*`; lessons SQL **unapplied** |
| Comms external send | deliberately refusal-only | `supabase/functions/comms-send/index.ts` returns 410 | none; no sends authorised |
| Roadmap milestones and approval | working | `src/data/supabase/roadmap-service.ts`, `roadmap-intel-service.ts` | `roadmap_*` tables |
| Roadmap to Projects handoff | code only | `src/data/projects-handoff.ts` (pure, no persisted ledger of the handoff itself) | `projects` |
| Projects delivery and acceptance | working | `src/data/supabase/projects-service.ts`, `project-delivery.ts` | `projects`, delivery tables |
| Clients book and commercial truth | working | `src/data/supabase/commercial-service.ts`, `/modules/clients` | `clients`, commercial tables |
| Agreement and onboarding as a stage | missing | no onboarding state machine exists; today it is a client record plus commercial truth | to be specified in a later round |
| Care and outcome review | code only | `src/domain/outcomes.ts`, Pulse read surfaces | review cadence is not persisted |
| Approvals | working | `src/data/supabase/approvals-service.ts`, `/modules/approvals` | approvals tables |
| Conductor routing | working | `src/data/conductor/orchestrator.ts`, `/modules/conductor` | conductor tables |
| Steward interpretation and memory | working | `src/data/supabase/steward-service.ts` | steward tables |
| Ops | external | registry `launchUrl: ops.trusttai.com` | the standalone Ops app |
| Studio | working, partial | `src/data/supabase/studio-brief-service.ts` | studio tables |

## 5. Home and the client workspace (A1.5)

**Specified, not built in this round.** No new dashboard, route or top-level app is
introduced; the existing navigation stands.

- **Role-based Home** stays `/` and stays the same page. What changes later is which
  sections it *fills*, driven by the viewer's `organization_memberships` role and the
  existing app-access rules: an owner sees decisions awaiting them, an operator sees
  the work they own, a viewer sees read-only attention. No role invents a section that
  does not already exist, and no role sees a section for a room it cannot open.
- **One client workspace** stays the existing client detail route
  `/modules/clients/$clientId`. It becomes the single place where the journey is read
  end to end for one company: stage, owner, next action, evidence, blocking reason,
  and links out to the owning room for every stage. It reads; the owning rooms write.
- **Minimal foundation fixed in this round**: the journey and handoff contract plus its
  validation, and the shared synthetic fixture. Nothing else.

## Boundaries carried into every later round

No outreach, publication, payment, production deployment, mailbox scope expansion or
schedule activation. New automation ships disabled or preview-only. SQL proposals go to
Codex and are never applied here. Unfinished Comms acceptance work and security fixes
stand untouched.
