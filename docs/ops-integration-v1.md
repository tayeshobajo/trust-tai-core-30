# Ops Integration v1

Ops is not a room inside Trust Tai OS. It is a separately deployed specialist
application at `https://ops.trusttai.com`. Trust Tai OS owns identity,
organization membership, canonical business projects, the shared activity
stream and cross-suite Intelligence. Ops owns technical workspace state,
environments, access, runs, approvals, QA, evidence, technical memory and agent
execution.

This integration is deliberately thin: one secure door out, one honest stream
back in.

## 1. The door out: SSO handoff

`src/lib/ops-launch.ts` opens `https://ops.trusttai.com/sso/waiting` in a new
tab and then waits. It posts nothing until Ops answers with
`trust-tai-ops:ready` from that exact origin.

Guarantees, each covered by a test in `src/lib/ops-launch.test.ts`:

- No session, no window. Launching signed out returns `no_session` and never
  opens anything.
- The token is never in a URL, a fragment, a window name, `localStorage` or
  `sessionStorage`. It exists only inside one `postMessage` payload.
- `targetOrigin` is the literal Ops origin. Never `*`.
- A ready signal from any other origin is ignored; the launch times out as
  `no_ack` rather than posting.
- A blocked popup reports itself instead of navigating the current tab.

Launch points: the Ops room (`/modules/ops`) and any open project workspace,
where the canonical project id travels with the handoff so Ops can attach its
technical work to the same business project.

## 2. The stream back in

Ops writes to the shared `activities` table with `app_key = 'ops'`. Trust Tai
OS only reads. Rows become `ContextBlock`s tagged `ops`, `observed` by default
and `decided` only when the row records a person's decision.

Technical risks (`ops.blocked`, `ops.issue_detected`, `ops.qa_failed`,
`ops.approval_required`) derive `technical_risk` signals. A risk stays open
until a later clearing event lands on the same chain, matched by canonical
project id, and a cleared chain produces a quiet "cleared" signal instead.
Every signal routes to the Ops destination URL carried on the row, or to Ops
home when none is given.

Organization boundaries are the existing ones: rows are read under RLS, and a
row belonging to another organization is invisible to both context and signals.

## 3. Idempotency

Ops retries. `docs/ops-activity-idempotency.sql` adds a nullable
`source_event_key` column and a partial unique index on
`(organization_id, app_key, source_event_key)`. Existing producers are
unaffected. The reader also de-duplicates in memory, falling back to event name
plus chain plus timestamp when no key is present, so a duplicate never counts
twice even before the migration is applied.

## 4. Access

Entering the Ops room requires `ops.read`, held by operator roles and above.
Ops enforces its own access independently; this is the outer gate, not the only
one.
