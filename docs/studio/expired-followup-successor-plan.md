# One successor after an expired, unlaunched follow-up

Prepared 2026-11-14. Design and approval plan only: no migration, new approval, configuration change, cancellation, renewal, or execution performed.

## Reconciled baseline

At 20:39:57–20:40:46 UTC:

| Record | Verified state |
| --- | --- |
| Original request / TRUA-103 | `6e04eb1f-720b-4b43-86a7-7330207a94aa`; host revision 3, uncertain, original run `3bd276dc-0500-40a3-81ea-b903c0c185ca` |
| Original evidence | One source evidence record; no completion, result, or stop receipt; legacy singleton remains consumed |
| Original callback | Historical submitted/running state; no brief or result digest. This is not evidence of a currently running process |
| Expired follow-up | Attempt `96d0e7fd-1664-48b3-93df-c99c87260bfb`, run `ea46169e-dff5-45dd-b8ec-5cc3b796137a`, expired 2026-11-14 18:09:08.464 UTC |
| Follow-up host | One approval, zero claims, phase receipts, cancellations, settlements |
| Follow-up callback | Revision 0; no admission, tokens, terminal state, result, or packet digest; not cancelled |
| Process observation | No Studio/OpenCode process observed; this does not prove no prior provider requests or cost |
| Live deployment | `b119809b77af2522901fb71f47dd9412ce09ddbe`; deployment `c4d7b607-e66c-42e8-941d-1a9ca1c4a049`; initialization/read succeeds |

Host/Supabase approval digest agrees: `4e0b5c59459569c8959fd4fee927c556407c887cb10162003384813bbeb6d70e`. The original uncertainty and unmetered cost remain unresolved, not reclassified as success or no-spawn. Process observation is a snapshot, not a process-completion receipt. Recheck all prerequisites immediately before activation.

The temporary Paperclip admin credential was revoked and remains unavailable. Last verified target-agent state was paused with heartbeat/wake/automation disabled; this must be freshly verified before any future run. No new admin login was initiated for this plan.

## Current support and required design

There is no supported v2 renewal/successor operation. `AttemptStore` and `studio_research_attempts_v2` both impose unique `prior_run_id`; both retain immutable approvals. Inserting another v2 approval for the same original run fails. Pointing priorRunId at the expired follow-up would fail the legacy history binding. Existing legacy unlaunched-renewal logic does not apply to the consumed original run or v2 record.

Do not edit expiry, delete approvals, drop uniqueness, reset the singleton, swap a request ID, clear uncertainty, or use a new company to evade these guards.

Recommended implementation is an explicit, narrow successor protocol, with new append-only storage and signed bindings, leaving v1/v2 records intact:

1. Define a distinct successor approval/certificate version and signature domain. Bind root request/issue and original run, exact expired predecessor attempt/run/approval digest, its expiry and reconciliation evidence, new attempt/run/nonce/session IDs, unchanged subject/org/company/project/agent/source/model/policy, fresh approvedAt/expiresAt, and explicit duplicate-cost acceptance. A maximum 15-minute execution-authorization window is retained. New IDs may be allocated inertly during preparation; no timestamped authority is minted yet.
2. Add host and Supabase successor registries with UNIQUE(original run) and UNIQUE(predecessor attempt) for this one permitted successor. They must be append-only, signature/digest verified, restricted to the existing trust roles, and bound to the retained v2 predecessor. Reject successors of successors. Any later request needs another reviewed design, not automatic chaining.
3. Host provisioning must atomically verify predecessor expired, its exact digest/lineage unchanged, zero claims/receipts/settlements/cancellations, and no existing successor reservation; then reserve the unique successor. Use a host-signed, bounded reconciliation attestation tied to the proposed successor approval digest. Supabase registration independently checks its predecessor remains revision 0 with empty state and verifies the matching attestation/bindings. No arbitrary operator-provided boolean proves absence of execution.
4. Cross-store staging is not a distributed transaction. Stage/reserve in a documented order, then pin the identical successor digest in CMD, host, and callback. Execution stays closed until both stores and all configurations agree. Partial provisioning, timeout, conflicting digest, replay, or lost response consumes/retains the reservation and stops activation; do not create another successor or automatically retry an uncertain write. Read-only reconciliation can establish whether the exact operation committed.
5. Extend approval parsing, provisioning/read/claim, repository validation, callback authority/admission/result validation, signed views, and explicit configuration selectors for the new version. Keep the existing final authority checks, paused-agent/issue ownership checks, private signer identities, one durable claim, no retries, source restrictions, and timing/cleanup evidence. No generic runtime wake or schedule is introduced. A successor's uncertain or consumed claim is terminal for this authorization.
6. Make CMD show execution eligibility separately from persisted status: server-authoritative `launchAllowed`/expiry/reason; display expired predecessor and original uncertainty. Disable Run for expiry or incomplete activation, including when a page crosses expiry while open. Retain server checks regardless of browser state. The current UI enables Run on stored approved/approved even after expiry; this must be fixed before the controlled test.

The exact schema names/version numbers, migrations, artifact hashes, and new approval digest must come from the reviewed implementation. This document is not an executable migration or an approved protocol change.

## Exact controlled-test scope and effects

- Existing request and TRUA-103 only; no replacement issue or unrelated task.
- Topic: “Explain IANA's example domains, their intended use, and limitations, citing only the approved IANA page.”
- Only approved source: https://www.iana.org/help/example-domains . The host fetches that public page using existing source validation. No broader web research.
- Existing company `aaa4eceb-44fb-4492-823c-65d3d90c5519`, project `d5160872-5d1c-41fb-b793-9ad7e4469f86`, paused agent `5cbc9418-0ff9-4f1c-a807-c0632e26a538`, organization `ee683a64-e045-4226-a8ff-4ae6590d6789`, Tai subject `e1b3c843-3a91-4c27-a291-9e6ced782b9f`.
- One fresh OpenCode CLI job/session. Existing provider `zai-coding-plan/glm-5.3` at `https://api.z.ai/api/coding/paas/v4`. Topic, approved source evidence, and constructed research prompt go to that provider. Existing model profile remains pinned; do not substitute a model to obtain availability.
- Existing policy: total execution budget at most 60 seconds, shortened by approval/invocation limits; preflight at most 20 seconds, launch at most 5 seconds, provider phase bounded by remaining total time; cleanup/settlement obey their existing bounded budgets. One CLI job is not a promise of one provider HTTP request.
- Native tools denied, steps 1, no skills/MCP/plugins, no automatic title/summary/compaction, no coordinator retry or generic wake. Internal provider calls and cost are unmetered; there is no verified hard dollar cap. Original cost is unknown and duplicate cost is possible. If a hard dollar ceiling is required, stop and implement/verify provider-side enforcement first.
- Effects: source HTTP fetch; provider request(s); private temporary run files; append-only host/callback admission, phase, failure/completion, and result records; authenticated research brief available in Studio if valid. No draft generation, voice examples, publishing, emails/outreach, automatic learning, content-source insertion, or scheduled/background run.
- Deadline/cancel attempts process-group stop and records actual evidence; do not promise remote provider cancellation or no charge. Missing stop/receipt evidence remains uncertain. Failure means reconciliation, never an automatic rerun.

## Preparation and release sequence

1. Implement the narrow successor contract and expiry-aware UI locally. Do not mint authority. Build reproducible host/CMD/callback artifacts and migration candidates. Review the final diff and validate with synthetic fixtures and isolated databases.
2. Required tests: expired untouched predecessor succeeds; every claim/receipt/admission/terminal/cancellation blocks; nonexpired predecessor blocks; changed root/digest/scope/model/subject blocks; forged/stale attestation blocks; concurrent provisioning produces one reservation; successor-chain/replay/second claimant blocked; partial activation fails closed; restart retains claims and uncertainty; original records unchanged; old v2 cannot start after expiry; UI disables at expiry; callback replay/order rules and no retry remain intact. Test source/credential handling without live provider calls.
3. Present exact commit, migrations, artifact/config hashes, rollback/disable procedure, and test evidence for publication approval. Take a fresh verified backup before host/schema changes. Rollback must disable successor execution and preserve new evidence; it must not erase reservations or replay an approval.
4. Obtain a fresh supported Paperclip admin login only if needed for installation/configuration. Tai personally approves the grant; scope it to the deployment work and revoke after completion. Never restore the revoked key. Complete consent and artifact installation before minting the short-lived execution authority.
5. Deploy reviewed support dormant/unconfigured, verify old reads and expiry-safe UI, reconcile both histories again, verify host process quiescence and paused/unscheduled target, current issue ownership, membership/access, provider configuration, and matching trust pins. Reconcile any conflicting evidence before proceeding.
6. Only after an explicit final one-test approval, create one immutable successor approval with a fresh window no longer than 15 minutes, provision once through reviewed entrypoints, apply matching configuration pins, and publish any necessary environment update. Record exact UTC window and identities. Check read-only readiness and sufficient remaining execution/settlement time. If activation takes too long or anything differs, stop; no silent reissue/extension.
7. Submit Start once. If the request outcome is uncertain, read status rather than submitting again. Collect signed result/phase/stop evidence in both stores and UI. Report actual outcome, missing evidence, and unknown cost. Revoke temporary admin access. No follow-on execution.

## Concrete approvals to request later

Do not ask Tai to approve an unspecified implementation now. Once artifacts and checks are reviewable, request publication of the exact commit, named host package, additive migrations, callback deployment and matching CMD/host/callback configuration changes. Explicitly state this installs successor support without starting a test.

After installation and reconciliation, use a final request such as:

> Approve one successor to expired unlaunched attempt 96d0e7fd-1664-48b3-93df-c99c87260bfb for TRUA-103, preserving that approval and the original uncertain run. It will use only the IANA page and existing GLM-5.3 provider, one fresh CLI job under the existing 60-second total execution policy, with no retries, drafts, publishing or scheduled work. This sends the research prompt/source evidence to Z.AI and stores the result/receipts privately in Studio. Provider calls/cost are unmetered, there is no verified dollar cap, and the original attempt may already have incurred cost. May I mint and provision one fresh approval lasting at most 15 minutes after your approval, complete the listed matching configuration activation, and start it once only after all checks pass? If the window expires or any check fails, I will stop without renewing or rerunning.

At that point attach the exact successor IDs, reviewed policy/commit/artifact identifiers and activation actions. Log the human approval reference in the signed audit provenance. A simple “Publish” approves deployment only when that is the question; it must not be interpreted as fresh execution approval.
