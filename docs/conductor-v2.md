# Conductor V2 — approval and execution orchestration

V1 could reason. V2 can be *told yes* — and only then hands work to the room
that owns it. Everything in `docs/conductor-v1.md` and
`docs/architecture-canon.md` still holds, unchanged.

> The Conductor coordinates. Steward interprets. Owning rooms execute.
> Approval is permission, not execution. Nothing is ever reported as done
> unless the owning room said so.

## 1. The lifecycle

```text
proposed ─approve→ approved ─route→ routed ─(owning room)→ accepted → executing → completed → measured
   │                   │                │
   ├─hold→ held ───────┘                └─fail→ failed
   ├─reject→ rejected                withdraw→ withdrawn
```

`src/domain/conductor-control.ts` holds the states, the legal transitions
(`ALLOWED_TRANSITIONS`, enforced by `assertTransition`) and the consequence
classes. Illegal moves throw; there is no path from `proposed` to `completed`,
and no path out of `rejected`.

**Consequence class decides how far a thing may travel.**

| Class | Meaning | Routable |
| --- | --- | --- |
| `informational` | Opens a view | No — there is nothing to route |
| `internal_preparation` | Prepares a draft nobody has sent | Yes |
| `internal_change` | Changes internal state in one room | Yes |
| `external` | Leaves the building | **Never.** A person does it |

Unlisted operations default to `internal_change` and are only routable if a
room adapter claims them. Guessing "harmless" is the mistake the table exists
to prevent.

## 2. The control objects

Two governance records, neither of which is business truth:

- **`conductor_actions`** — what was prepared, what a person decided, and where
  it got to. It stores *references* (`projectId`, `relationshipId`), never a
  copy of a room's record.
- **`conductor_receipts`** — what actually happened at the boundary: which
  adapter, which room service, whose approval, when, and the result or the
  failure. A receipt is written whether the hand-over succeeded, was refused,
  or failed. Silence is never an outcome.

Both are unique on `(organization_id, source_event_key)`. Asking the same
question twice does not duplicate the queue; retrying a route does not
double-hand the work.

Schema: `docs/conductor-v2-schema.sql` (apply after the V1 schema). RLS via the
existing `private.is_org_member`; `anon` holds nothing; no delete grant, because
the audit trail is append-and-amend only.

## 3. The adapter layer — the only way out

`src/data/conductor/adapters.ts`. A `RoomAdapter` may act for exactly one room
and only for operations it names. It calls that room's **existing service**, so
the room's own permission checks and RLS still apply. There is deliberately no
generic "write a table" escape hatch, and the Conductor never imports another
room's Supabase table directly.

Shipped adapters:

- `comms.draft_reply` → the Comms draft service. Saves a draft. Sends nothing.
- `projects.record_blocker` → the Projects service. Records a blocker. Does not
  move a date or reassign anyone.

Rooms with **no adapter yet** (Scout, Roadmap, Ops, Studio) are reported to the
person as *approved but not routable, and why* — `ADAPTER_GAPS` names the
reason. An approved action nobody can carry is stated honestly; it is never
quietly marked done.

## 4. Selective approval

`decideActions` in `src/data/intelligence/conductor/control.ts` moves only the
actions a person names. Approve one step of a five-step graph and the other
four stay `proposed`. Hold and reject carry a reason. A held action can be
released later; a rejected one cannot be revived.

Dependency order is real: an action whose prerequisite has not yet reached the
owning room is refused with `blocked_by_dependency` and the prerequisite's name.

## 5. Permissions

Two new permissions in `src/domain/access.ts`:

- `conductor.approve` — may decide the queue.
- `conductor.execute` — may hand an approved action to a room.

Both are leadership/administrative. Fail closed: no access context, inactive
membership, or a foreign `organizationId` all mean no. On top of that, the
owning room re-checks its own permission inside its service — the Conductor's
approval never substitutes for `comms.write` or `projects.write`.

## 6. The audit trail

`src/domain/control-events.ts` defines the governance vocabulary
(`conductor.action_proposed|approved|held|rejected|routed|failed|withdrawn`),
emitted through `src/data/events/control-events.ts` into the one shared
activity stream, with provenance and a stable `sourceEventKey`. These are
governance events about the Conductor's own conduct — they never claim a room's
domain event on that room's behalf.

## 7. What the Conductor may say

`controlResponse` produces the sentence shown above the queue. It may say
prepared, awaiting you, approved, handed to Comms, blocked, refused, or failed.
It may not say done. Completion is only ever reported by the room that owns the
work, through `readStatus`.

## 8. Deliberately deferred

- Adapters for Scout, Roadmap, Ops and Studio (no safe service boundary yet).
- Automatic completion polling; today completion is read on demand.
- Outcome measurement is modelled (`attachOutcome`, `measured`) but only
  attaches once a room reports `completed` — nothing infers it.
- Any autonomous execution. There is no code path that routes without a person.
