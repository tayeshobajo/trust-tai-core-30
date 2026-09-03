# Approvals V1

The room where decisions get made.

Approvals is not a business room. It owns no entity and writes no room's truth.
It owns exactly one thing: **the decision, and the provenance of the decision**.
Every other room prepares work, submits it here, and executes only after a
person has said yes.

## The laws

1. **Agents prepare. Humans approve. Execution happens after approval.**
2. **Source apps own the work. Approvals owns the decision.** An approval record
   holds references and small immutable audit snapshots. It never becomes a
   second copy of a prospect, relationship, roadmap change, project or post.
3. **Approved is not executed. Executed is not verified.** Three states, never
   collapsed, never inferred from each other.
4. **AI handles volume. Humans handle exceptions.** A batch is one decision
   object with child items. Only genuine judgment calls become exceptions.
5. **Nothing skips the human.** A request cannot reach `executed` without
   passing through `approved`, enforced by the state machine, not convention.

Law 5 is proved by test: every pre-decision state refuses a transition to
`queued`, `executed` or `verified`.

## The state machine

```text
needs_review ─┬─> ready ─────┬─> approved ─┬─> queued ──> executed ──> verified
              │              │             │                 ^
needs_context ┘              │             └─> rejected      │
              ^              │                               │
              └── revision_requested <──────────────────────┘ (resubmission)
```

`rejected` and `verified` are terminal. A decided request is history: a source
app that resubmits the same state gets the existing record back, unchanged. It
cannot quietly reopen a closed decision.

## Identity and idempotency

Every request carries a `source_key`, derived from the source app, the approval
type, the source entity and an optional aspect:

```text
scout:scout_relationship:prospect:p-1
comms:comms_draft:comms_relationship:rel-1
```

A unique index on `(organization_id, source_key)` means a retry, a rerender or
a second agent pass resolves to the same row. Batch items are keyed the same
way inside their request, so a resubmitted batch updates rather than doubles,
and any item already decided keeps its decision.

## Authority

Two gates, both required, both fail closed:

- `conductor.approve` in the workspace, the leadership act of authorising work.
- The owning room's own write permission, carried on the request as
  `required_capability` (`comms.write`, `scout.write`, `roadmap.decide`,
  `projects.write`).

Approvals never substitutes for the room that carries the work. A person who
can write in Comms but holds no approval authority cannot decide, and an
approver without `comms.write` cannot decide a Comms draft either.

## The universal shell

Every approval type shares one shell: header, why-this-needs-you, the
type-specific middle, the boundary statement, the decision bar, the trail. Only
the middle differs, and it is delegated to a registered renderer that reads its
own `payload` and nothing else. The shell reads the universal fields and never
the payload.

Registered types in V1:

| Type | Source | Tab | Decision language | Goes home to |
| --- | --- | --- | --- | --- |
| `comms_draft` | Comms | Comms | Approve for sending | Comms send queue |
| `scout_relationship` | Scout | Scout | Approve and queue | Comms relationship |
| `blog_batch` | Content | Marketing | Approve N of M | Publishing queue |
| `roadmap_change` | Roadmap | Roadmap | Approve | Roadmap decision log |
| `delivery_change` | Projects | Delivery | Approve and hand over | Project change order |

A test asserts that every declared type has both a renderer and a downstream
path, so the room cannot fragment as types are added.

## What happens after approval

Approving records authority and nothing else. The handover is a second,
separate act with its own recorded state, and it has three honest outcomes:

- `queued` the owning room accepted the decision and will act on it.
- `unavailable` the decision is recorded and the execution path does not exist
  yet. Said plainly rather than dressed up as success.
- `failed` the handover was attempted and refused.

## Prioritisation

Ranking, not a displayed score. It reads urgency, impact, whether the boundary
mentions an irreversible act, how many exceptions a batch carries, and how long
the request has waited. Where the data is thin the ranking stays coarse rather
than inventing precision.

## Data

Three tables, all governance, all RLS-scoped through `private.is_org_member`,
none deletable:

- `approval_requests` what was prepared and why it needed a person.
- `approval_items` the members of a batch.
- `approval_events` the append-only trail of notes, decisions and handovers.

Apply `docs/approvals-v1-schema.sql`. Until it is applied the room reads as an
empty queue and says so explicitly rather than implying nothing needs deciding.
