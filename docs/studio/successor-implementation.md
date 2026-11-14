# Local successor candidate

This implements the expired-followup-successor-plan locally. Nothing was pushed, deployed, provisioned, renewed, or executed against live services. The deployed version remains b119809b.

## Changes

- Approval version 3 uses the distinct `studio-successor-approval/v1` domain. It binds the exact expired v2 predecessor, original uncertain run and historical approval, new IDs, owner approval reference, unchanged policy, and a fresh window of at most 15 minutes.
- Host `AttemptStore(..., 3).provisionSuccessor(...)` verifies the signed approval and pin, checks original uncertainty and zero predecessor evidence under `BEGIN IMMEDIATE`, and atomically reserves one successor per original run. It returns a host-signed reservation attestation lasting at most 60 seconds. A read-only `reservation(id)` can reconcile a lost response; it cannot refresh that attestation. Replays/duplicate provision/claims are rejected. Host v2 evidence inserts are frozen after reservation, including late cancellations/settlements.
- `provisionCallbackSuccessor` is an explicit operator-only function with injected predecessor-read and atomic-insert adapters. It verifies Studio and host signatures, matching digests/lineage, fresh attestation, and untouched callback state. It is not exposed as an HTTP/server-function route and never signs or mints an approval. Its insert row targets the new v3 table; the migration supplies the authoritative lock/constraints. It performs no retry. Deployment alone never calls either provisioning function.
- The additive migration retains all v2 approvals and unique constraints. Separate v3 approval/state/packet/cancellation/nonce storage uses existing guarded CAS rules. The predecessor row is locked, time is checked after lock acquisition, and subsequent predecessor state mutations are rejected. Explicit revokes neutralize inherited service-role ALL privileges on v3 and predecessor state/packet tables; only intended SELECT/INSERT and guarded RPC access remain.
- Runtime selection is explicit: CMD config3, callback config3, host config5. Existing CMD/callback2 and host4 stay on v2 storage and reject v3 approvals; no fallback is allowed. Signed transport and receipt envelopes remain v2, with the exact v3 approval digest in every binding. No existing configuration is changed.
- The UI reads the server-configured attempt through an authenticated, ownership-checked server function while retaining the fixed request/org scope. It starts only that exact verified ID. Server eligibility uses verified approval, work access, fresh clock, untouched host and callback states. UI defaults closed, subtracts response latency, uses monotonic expiry, rechecks on click, and clears eligibility after failed reads/hidden-page events. Stored approved status is never treated as current execution eligibility. A durable host claim with no phase receipts now projects claimed, not approved.
- Host package candidate version is 0.1.0-dev.16; plugin identity and capabilities are unchanged. There are no schedules, automatic retries, new credentials or provider calls introduced.

## Verification

578 synthetic tests across 42 files pass. Coverage includes preserved predecessor/root history, exact identity/scope binding, invalid signatures/attestations, wrong versions, duplicate reservations/claims, restart durability, cancelled/claimed/settled predecessors, full coordinator+callback success with mocked runtime, missing callback registration blocking spawn, expiry-aware UI, and exact configured-attempt selection. Host and repository version-isolation tests are inert and intercept all network/provider access.

The isolated PostgreSQL harness passes additive migration application, missing/changed binding rejection, cancellation-before-registration, registration-before-cancellation, simultaneous duplicate reservation, attestation expiry while blocked on a row lock, immutable approval/delete rejection, inherited privilege restriction, and successor guarded cancellation. It creates a temporary cluster with a private Unix socket and no TCP listener, and stops it afterward. Fixtures and keys are synthetic.

Root typecheck and production build pass. Host build and callback bundle/import audit pass; callback contains no host SQLite/process modules. Validation details and artifact SHA-256 values are in `qa/studio-successor/validation.json`; generated bundles/logs are local deliverables, not checked into source.

Independent source review identified three issues, all corrected: predecessor mutation after reservation, inherited service-role privileges bypassing state CAS, and stale clock use before waiting for the predecessor lock. Final review reported no remaining source blocker. The reviewer did not independently rerun tests. These are local proofs, not evidence that a deployed v3 transport, migration, or runtime is ready.

Reproduce from repository root:

```sh
npx vitest run --config qa/studio-successor/vitest.config.ts
npx tsc --noEmit
npm run build
python3 qa/studio-successor/sql-test.py
node qa/studio-successor/build-callback.mjs
```

Host: run `npm run build` inside `packages/studio-research-coordinator`. SQL harness currently requires Homebrew PostgreSQL17 and local shared-memory permission. No configured production database is consulted.

## Remaining release risks and approval

- Cross-store activation is not atomic. Partial or ambiguous provisioning stays closed and retained; reconciliation cannot mint a fresh attestation/window or reserve another successor. If the short attestation expires before registration, stop for a reviewed recovery decision rather than recreating authority.
- The signed reservation is trusted at the explicit operator registration boundary. The SQL role cannot verify Ed25519 itself; keep service credentials private and register only via the verified function/adapter. Config pins and host durable reservation independently constrain runtime execution.
- The original run remains uncertain and its provider cost remains unknown. One CLI job does not enforce one provider request or a hard dollar cap. No live provider/transport test was run.
- A fresh backup and supported temporary Paperclip admin grant are needed before changing the installed host; the previous grant is revoked. Review migration ACL impact and current store state immediately before applying it.
- Rollback disables successor configuration and preserves all reservations/receipts. Do not drop the new tables/triggers or restore a stale database over evidence.

Next approval is deployment-only for the final exact commit on `tayeshobajo/trust-tai-core-30`, branch `codex/cmd-roadmaps-preview-source`: push; publish CMD; apply `20261114000200_studio_successor_candidate.sql`; install the recorded dev16 artifact through supported Paperclip admin flow; deploy the recorded callback bundle. Retain existing runtime selectors/pins so successor execution stays unconfigured. No successor row, signed approval, execution-window activation, or Start is included.

Only after this release and fresh reconciliation should Tai receive the separate concrete one-test approval request in the plan. Attach actual inert successor IDs and exact activation actions at that time. That request must explicitly accept IANA-only prompt/source transmission to the existing Z.AI provider, possible duplicate/unmetered cost, a single new <=15-minute authorization window, one <=60-second-policy CLI job, no retry, and no publishing/outreach/schedules. A publish approval is not an execution approval.
