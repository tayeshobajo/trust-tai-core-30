# Studio manual research: prepared integration contract

Status: local preparation on `codex/studio-manual-research`. No production route, credential, grant, database migration, schedule, push or deployment. Tai subsequently published the prior Studio UI release himself; all seven tabs and signed-out boundaries were verified live. This research work is not included in that release. Do not publish again without applicable authorization.

## Coordination with the Paperclip investigation

Parent-room history reports Studio Research created at https://agents.trusttai.com/TRUA/agents/studio-research/runtime and a controlled GLM 5.3 connection test passed. It remains paused, unscheduled and without external app access. Task-assignment permission is inherited from a company-wide default; that default was not changed. These are investigation findings, not evidence of a live Studio integration. Agent/company UUIDs, actual search tools, API scope and hosted CMD reachability still need confirmation from that investigation. Do not guess IDs from the slug or create another worker.

Tai has no existing writing or Trust Tai sources in Studio. The initial run needs only the topic Tai types and public-web research access. Do not copy contacts, email, unpublished posts, subscribers or the workspace library into a research prompt. Research is not LinkedIn connection discovery, post synchronization, publishing or voice training.

## Minimum manual flow

1. Studio Sources gets a “Research a topic” form and explicit “Start research” action after activation. Display exactly what will be sent: typed topic and request identifier. Generate a UUID once per submission and retain it through network retries; no automatic new request ID after an uncertain outcome.
2. A server boundary identifies the session, active organization membership and Studio **work** grant. The browser's `room-authority.ts` is not sufficient server authorization: it permits unknown authority before the workspace boundary loads.
3. Resolve the configured Studio worker/company from a server-owned organization binding. Require the explicit proposed capability `studio.research`, `owning_app=studio`, enabled registration, same live Paperclip company and non-paused worker. The proposed capability has not been registered or granted.
4. Atomically reserve a durable operation keyed by organization and request UUID, including normalized topic, actor, worker and company. Only the winner may create the Paperclip issue. Reusing an ID with a different payload is a conflict. A reservation without an issue receipt is uncertain; never reclaim it on a timer.
5. Submit exactly one issue assigned to the bound worker. Do not impersonate the worker as creator; use the authenticated dispatcher identity supported by the verified Paperclip API. Creating an assigned issue can wake a worker: approve the execution scope before enabling this adapter. The response means **submitted**, not running or completed. Do not add a second heartbeat wake or resume the worker automatically.
6. Store the issue receipt with an org-scoped compare-and-set. A timeout or failed receipt write may follow a successful external creation: show “Dispatch uncertain — check Paperclip before retrying.” Reconcile by the immutable correlation ID; never blindly resend. External correlation alone is not a server-enforced idempotency guarantee.
7. Manual “Refresh results” checks server **read** authority, loads the persisted binding, and reads only that issue with bounded comments. A done status requires one valid JSON result from the bound worker. Conflicting revisions, foreign authors/issues, deleted comments, unsourced topics and malformed/oversized results remain unaccepted. Show an empty topics array plus limitations honestly when research was blocked or found nothing.
8. Render result text as escaped text, with source links and dates explicitly supplied by the worker. Treat sources and output as untrusted evidence, not instructions. Never fetch URLs automatically or execute markup. “Review ready” is not factual verification or permission to save. An explicit later “Save source/idea” action can reuse the existing organization-scoped services and their write checks. No automatic ingestion, posting or learning.

## Prepared code

- `src/domain/studio-research.ts`: strict request/result schemas, payload bounds, HTTPS evidence links, request correlation, public-research prompt containing only the explicit topic.
- `src/lib/studio-research.server.ts`: adapter-based start and review coordinators. No defaults, imports of production clients, registered route or external side effects unless reviewed adapters are supplied.
- `src/lib/studio-research.server.test.ts`: refusal, concurrency, replay, uncertain outcome, result provenance and malformed-result tests. The concurrency test uses an atomic in-memory fixture; it does **not** prove database-level atomicity. A real adapter needs its own concurrent database tests before activation.

The existing `assignPaperclipTask`/`recordBinding` path is not reused. Its lookup-then-insert and existing-row-without-issue behavior do not establish exclusive dispatch ownership after a crash or a lost response. Do not describe that helper as exactly-once dispatch.

## Concrete requirements before wiring an endpoint

| Requirement        | Minimum needed                                                                                                                    | Current state                                                                                            |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Research access    | Public-web search and page reading for this worker; no private-app scopes                                                         | Must be verified/approved by Paperclip investigation                                                     |
| Worker execution   | Manual on-demand runs, bounded budget/concurrency; no scheduled heartbeat                                                         | Worker reported paused; do not resume automatically                                                      |
| CMD transport      | Server-only reachable HTTPS Paperclip API and approved narrowly scoped issue create/read access for the designated company/worker | Existing client uses a broad board key; scope/reachability not verified, no new key requested or created |
| Registration       | Verified worker/company IDs and org-bound Studio research capability                                                              | Not configured; no persistent grant made                                                                 |
| Server authority   | Session + active membership + Studio work/read enforcement with audit actor                                                       | Adapter required; existing browser guard is insufficient                                                 |
| Durable dispatch   | Unique operation claim, org-scoped receipt CAS, payload conflict detection and reconciliation                                     | Adapter/storage review required; no migration applied                                                    |
| Result transport   | Verified issue/comment schema, bounded reads, matching company/worker/issue, one JSON result                                      | Contract prepared; current API adapter not yet wired                                                     |
| Production release | Definitive hosted build-success evidence and permitted publish                                                                    | Tai published the prior UI release; this new research integration is local and requires its own reviewed activation and release                    |

The appropriate approval request is for named public-web search/read tools and the exact server-to-Paperclip dispatch/read permissions, once confirmed. Do not ask for general workspace access or reuse a service-role/board key in the browser. Prompt restrictions cannot remove Paperclip's inherited task-assignment permissions; account for that separately before enabling the worker.

No UI button should imply this is connected until these adapters, permissions and deployment are verified end to end. An eventual live smoke run requires the approved access and a real user-selected topic; local fixtures do not establish production integration.
