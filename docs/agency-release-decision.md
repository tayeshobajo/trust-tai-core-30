# Release decision: Trust Tai OS agency engine

Prepared for Tai. This is a decision paper, not a deployment. Nothing here has
been published, activated or applied.

## Three separate statements

| Statement | Answer today |
| --- | --- |
| BUILD CONNECTED | Partly. Home, client continuity, the journey strip and business health read real records at real routes under the signed-in session. The three preparation jobs are IMPLEMENTED-UNCONNECTED: the entry point exists, no room calls it, and its tables do not exist. |
| VERIFIED | No. No signed-in screen evidence, no real model run, no persisted preparation output, no measured latency or cost, no viewport or keyboard pass on a signed-in screen. |
| HUMAN ACCEPTED | No. Not claimed. Tai's voice and judgment acceptance and representative team usability acceptance are both outstanding, and neither may be recorded by anyone else. |

Because VERIFIED and HUMAN ACCEPTED are both No, this candidate is not ready
for release. That is the recommendation.

## Unmet requirements, in the order they block

1. Preparation schema absent. `preparation_outputs`, `preparation_attempts`
   and `preparation_policy` do not exist, so prepared work cannot be written,
   read, repeated, revoked or recovered. Owner: Codex.
2. No automatic trigger. No room handler calls the preparation entry point, so
   the three jobs cannot be demonstrated event-driven even once the schema
   lands. Owner: Lovable.
3. No signed-in verification. The end-to-end synthetic journey, reload and
   resume at discovery, proposal and delivery, and the 1440 / 768 / 375 and
   keyboard checks all need a session on the pinned build. Owner: Codex.
4. No synthetic sandbox organization. Carrying a synthetic client through
   persisted records would mean writing into the shared production workspace,
   which this queue does not authorize. Owner: Tai.
5. No invoicing or payment source. Receivables and margin stay declared
   unavailable, correctly, until one is connected. Owner: Tai.
6. No measured productivity. Latency, usage, cost and human edit counts need
   real runs, and a manual baseline needs real people. Nothing is claimed.
   Owner: Tai.
7. Comms live checks still blocked from the earlier closure work, with their
   original records intact. Owner: Codex.
8. Target editing for owners and admins is not built. Owner: Lovable.

## SQL awaiting review, not applied

| Proposal | State |
| --- | --- |
| `docs/migrations/proposed/20260916170000_preparation_outputs_r1.sql` | Revised, unapplied. Immutable lifecycle, minimal grants with an explicit revoke first, RLS, attempt history. Needs Codex review and Tai approval before any application. |
| `comms_review_opportunities_nullable` | Already applied and archived. Do not reapply. |

## Configuration a release would need

- Apply the preparation schema, then leave every job disabled.
- Enable jobs one at a time, by an authorized person, with the quota and
  attempt limits already in the runner.
- Set weekly targets in Settings, Outcomes. Until then, Pulse correctly shows
  no target rather than a built-in default presented as a decision.

## Rollback

Every view added in R3 and R4 is read-only: removing the mounted sections in
`src/routes/index.tsx`, `src/routes/modules.clients.$clientId.tsx` and
`src/routes/modules.pulse.tsx` returns those screens to their prior state with
no data change. The preparation jobs roll back by leaving the policy disabled;
no row is written while disabled.

## Scope of a whole-suite publish

Not requested and not prepared here. A publish would carry Comms, Scout,
Roadmap, Projects, Clients, Ops, Pulse, Home and Studio together, so the
outstanding Comms acceptance rows would ship with it. That is a reason to
settle Comms before, not after, any publish decision.
