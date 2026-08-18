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

`src/lib/ops-launch.ts` opens `https://ops.trusttai.com/sso` in a new tab and
then waits. It posts nothing until Ops answers with `trust-tai-ops:sso-ready`
from that exact origin, then posts a single `trust-tai-os:sso` message.

The contract belongs to the Ops bridge (`src/suite/ssoBridge.ts` in Ops) and
this side matches it exactly:

| Piece | Value |
| --- | --- |
| Landing path | `/sso` (Ops matches `/^\/sso\/?$/`) |
| Ready message | `trust-tai-ops:sso-ready` |
| Handoff message | `trust-tai-os:sso` |
| Handoff payload | `{ type, accessToken, organizationId, canonicalProjectId?, returnContext? }` |

`organizationId` is required and must be a UUID. Without it, or with a
malformed one, the launcher fails closed before any window is opened.

Guarantees, each covered by a test in `src/lib/ops-launch.test.ts`:

- No session, no window. Launching signed out returns `no_session` and never
  opens anything.
- No organization, no window. A missing or non-UUID `organizationId` returns
  `no_organization` and posts nothing.
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

Ops retries. `docs/ops-activity-idempotency.sql` adds a nullable `source_event_key` column
and a partial unique index on `(organization_id, app_key, source_event_key)`.
It has been applied to the live Trust Tai Supabase project.

Reading prefers the top-level `source_event_key` column, then
`provenance.ops_event_key`, then `provenance.dedupe_key` for rows written
before the column existed, and finally falls back to event name plus chain plus
timestamp. Writing sends the key both as the top-level column and as
`provenance.dedupe_key`, so older readers stay correct.

## 4. Access

Entering the Ops room requires `ops.read`, held by operator roles and above.
Ops enforces its own access independently; this is the outer gate, not the only
one.

## 5. The Ops room as a portfolio

`/modules/ops` is no longer a launch page. It reads the same shared
`activities` rows and folds them, in `src/data/ops/projection.ts`, into a
read-only portfolio: one entry per Ops chain (canonical project, run, or
issue), with open issue and approval counts, latest run or QA result, last
activity, and health derived from what is still open.

No projection table exists in Core and none is created. Trust Tai OS holds no
editable copy of Ops truth; a filtered view of Ops evidence is all it is.

Fields are shown only when Ops sent them. Company, environment, owner and
system name are read from the row payload (`company`/`client`, `environment`,
`owner`, `system`/`project_name`) and stay absent otherwise.

Freshness is stated as the age of the newest Ops row we can see
("Ops synced 42 sec ago"). If the read fails, the last-known projection stays
on screen under "Ops sync interrupted".

### Deep links

Rows open through the same handshake. The launcher now accepts `targetPath`, a
same-site path validated by `safeOpsTargetPath` (leading `/`, no `//`, no
scheme). It is posted alongside the token inside the single `trust-tai-os:sso`
message; Ops completes the redirect after the session is established. Nothing
sensitive is ever in a URL.

### Bounded Ops-side work still needed

For systems created directly in Ops to appear here without waiting for an
event, Ops must emit, per system, at least one activity row carrying:

| Field | Where | Purpose |
| --- | --- | --- |
| `app_key = 'ops'` | column | routes the row to this room |
| `source_event_key` | column | idempotency |
| `canonical_project_id` | payload | lineage to a Core project, when one exists |
| `system` / `project_name` | payload | portfolio row name |
| `company` | payload | company filter |
| `environment` | payload | environment filter |
| `owner` | payload | owner column |
| `destination_route` | payload | exact Ops path for the deep link |

An `ops.completed` or `ops.qa_passed` row with those fields is enough to show a
healthy system. Until Ops sends them, the room shows the truthful empty state.
