# Current dev.12 startup

The installed entrypoint now selects the explicit host-admitted Linux public preview when strict company configuration and supported secret references are present. Unconfigured startup remains unavailable. See qa/studio-research/DEV12-SETUP.md in the complete source bundle for exact configuration, controls, timing, remaining approvals and test limitations. Per-job OS containment is optional hardening for this preview.

## Historical design notes

# Dev.7 policy correction

See qa/studio-research/DEV7-REVIEW.md in the complete source bundle. Policy v2 admits one CLI job, not one provider request; provider count and cost remain unmeasured. Startup remains disabled. Historical notes below describe earlier snapshots.

# 0.1.0-dev.6 genuine-tool/transport candidate

Read DEV6-REVIEW and DEV6-PREVIEW-PLAN in full source bundle. Real OpenCode launch and production composition remain unavailable. Exports include concrete signed route/operation adapters and fixed genuine CLI preparation/supervision; no custom provider HTTP fallback.

# 0.1.0-dev.5 local defect fixes

See DEV5-REVIEW.md in complete source bundle. Expiry is rechecked after destination verification; UI state is scoped to organization and adapter identity. All production/provider gates remain unchanged.

# 0.1.0-dev.4 offline composition candidate

Production mode is unavailable. See qa/studio-research/DEV4-REVIEW.md in the complete source bundle. The exported composition requires all signed synthetic policy/admission/result/stop dependencies; it is not wired at startup. Direct Coding Plan custom-client use requires separate entitlement review/written agreement, not quota checking alone.

# Studio Research coordinator — local candidate 0.1.0-dev.3

This is a disabled development candidate, not an installed integration. The official Paperclip SDK is pinned to 2026.1012.0. The default worker has no authority, storage or executor adapters and returns unavailable. No subscription, schedule, native wake, runtime-log access, model request or database creation happens at startup.

## Contract and ownership

Studio owns the user's request and review. An independent trusted server authority must bind the authenticated subject, organization, immutable approval digest, request and permitted action to a short expiry. Plugin actor identity alone does not provide scoped bridge permission. No request body can establish approval. The internal approval method is deliberately not exposed as an API route.

Approval binds exact issue, organization, project, agent, public URLs, primary and auxiliary `zai-coding-plan/glm-5.3`, Coding Plan endpoint, denied native tools, one provider request and a 60-second execution limit. Approvals expire within 15 minutes. Optional voice drafts require three individually approved, hashed examples; none are populated by this package.

A private SQLite ledger owns immutable approval, evidence, execution receipt, result and review. Transactions and revision checks prevent duplicate claims; one active or uncertain job blocks further execution. State progresses approved → collecting → running → ready → reviewed. Cancellation, failure and uncertain outcomes are retained permanently. Restart reconciliation requires independently verified process quiescence and never retries a consumed job. Uncertain reservations have no automatic release route.

The reused source reader accepts at most three exact approved HTTPS URLs. It checks all resolved addresses, pins the public connection, verifies TLS, rejects redirects, limits time and bytes, and extracts bounded inert text with hashes. Model content is treated as data. Captured results require exact request/run/session/nonce provenance, strict structured output, source citations and public-person quotes. Citation matching proves source correspondence, not factual truth or identity. Review decisions are stored only; Use/Save do not yet create Studio records, Edit does not train a model, and nothing publishes or contacts people.

## Local validation

From repository root: `./node_modules/.bin/vitest run --config qa/studio-research/vitest.config.ts`, `node --test qa/studio-research/transport.test.mjs`, `./node_modules/.bin/tsc --noEmit`, `npm run build`.

From this package: `npm run check`, `npm run build`, `npm pack --ignore-scripts`. Dependencies were installed locally with lifecycle scripts disabled. Tests use real temporary SQLite files and mocked authority, source and executor boundaries; they do not use credentials or providers. Built bundles target Node 24; local tests used Node 26.13.0. Host Node 24.22.0 compatibility still needs runtime validation.

## Revision 2 local adapters and evidence

The new authority verifier accepts a signed Ed25519 task attestation only alongside an independently authenticated user session and active work access. No issuer, trust key, credential, route or session transport is configured. The SDK does not propagate bridge credential scope; it cannot be recovered from a client claim. Test signing keys are ephemeral and never saved.

The result relay verifies a signed envelope against an independent ready/reviewed ledger job, exact run/session, immutable approval, source evidence, prompt and result digests before calling an atomic existing-record writer. Tests use a real local SQLite target. The production writer explicitly rejects all calls: the legacy comment-based schema must not be bypassed.

Approval now binds the fixed prompt-policy digest. Launch records retain nonce, fixed profile, source/prompt hashes and deadlines; ready records atomically retain the validated sanitized receipt, output digest, observed completion time and reported request count. These are coordinator observations, not proof of provider billing. Durable cancellation is polled by the owning instance every 25 ms; a failed/absent owner still requires quiesced reconciliation. Source retrieval is bounded to 12 seconds but not externally abortable. An executor must enforce the supplied abort signal and launch/completion deadlines itself; the absent production adapter provides no such guarantee.

The separate synthetic test supervisor in qa/studio-research starts only a fixed inert Node fixture, with no inherited application environment, a private temporary directory, no shell, restricted Node 26 permissions, bounded input/output and stop acknowledgement after actual child close. macOS injects __CF_USER_TEXT_ENCODING; no application secrets are inherited. It is not a model runner, not shipped as the plugin executor, and not an OS security sandbox. Native Node 24 provider integration remains untested.

## Deliberately unresolved production boundaries

1. A supported trusted approval adapter must preserve actual scoped-key identity and exact request permission. Official plugin actor metadata lacks key ID/scope. Do not substitute agent identity or broaden the wake gate.
2. A reviewed executor must enforce one provider request, model/tool restrictions, token/cost bounds, fresh sessions, process termination and no retry before invocation. Mock receipts cannot prove these properties. Native OpenCode ordinary invocation is not used; structured task goals are unavailable in the inspected adapter.
3. A result relay must write through an authenticated, narrowly scoped path into the existing Studio request store. Plugin-authored results must not impersonate native agent comments. The new brief envelope requires an explicit integration mapping.
4. SQLite is a proposed local receipt ledger, not a deployed store. Its permissions and hash checks are not protection against the host account or root. Private path, retention, backup, concurrency and uncertain-job reconciliation need operator review.
5. The SDK trusts plugin code; the manifest is not an OS sandbox. No compatibility, isolation, cost or live end-to-end claim follows from these mocks.

See `qa/studio-research/PRODUCTION-APPROVAL-PACKET.md` in the checkout. Official package conventions: https://github.com/paperclipai/paperclip/blob/master/doc/plugins/LOCAL_PLUGIN_DEVELOPMENT.md . SDK definitions are checked against the locally installed pinned release, not inferred from current upstream documentation.

## Revision 3

See qa/studio-research/DEV3-REVIEW.md in the source bundle for concrete Studio issuer/receipt-store preparation, staged SQL, offline Coding Plan protocol tests and residual gates. The package remains headless and disabled; Studio-side handlers live in the app source, not the plugin distribution. Cancellation stale-revision and rejected-acquisition races are fixed. JSON digests now canonicalize object key order for JSONB; no automatic old-ledger migration or replay is permitted.
