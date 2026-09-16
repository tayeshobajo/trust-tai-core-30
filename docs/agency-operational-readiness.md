# Agency operational readiness

One record per round of the correction queue. Each round keeps the exact prompt
that was submitted, numbered acceptance rows, the files that changed, the trace
from route to service to record, the build it was checked on, the evidence
level, the owner and the next action.

Evidence levels, kept apart on purpose and never rolled into one number:

| Level | Means |
| --- | --- |
| CODE | The rule exists in code and is unit tested. |
| IMPLEMENTED-UNCONNECTED | Written and tested, but nothing real calls it yet. Never a functional pass. |
| SYNTHETIC | Executed end to end against invented material, in memory. |
| SQL-UNVERIFIED | SQL written and reviewed by eye. Never executed anywhere. |
| PERSISTED | Written to and read back from the real database. |
| LIVE | Observed on a real signed-in screen. |
| TEAM | A person accepted it. Never self-awarded. |

Baseline reviewed before editing: commit `16e4f83`. Pinned build for this
round: `16e4f83` plus the changes listed below, `bunx tsgo --noEmit` clean and
`bun run build` OK.

---

## Round R1 of 5: make preparation execution safe and connectable

### Exact prompt submitted

> TRUST TAI AI AGENCY OPERATIONAL READINESS. Tai authorizes this agency
> operational-readiness correction queue. Review baseline commit 16e4f83 and
> latest changes before editing; preserve concurrent Comms work and all C/T/P/A
> criteria. Goal: eight people can move a client through real work with clear
> outcomes, owners, next actions and visible exceptions. Continue existing apps
> and owning services, white cards/pale blue, no parallel CRM or approval
> system. Build working routes/adapters/event handlers, not only standalone
> helpers and synthetic tests. Preserve exact prompt and numbered acceptance
> criteria in docs/agency-operational-readiness.md, with changed files,
> route-to-service-to-record trace, pinned build, evidence level, owner and next
> action. Unwired code is IMPLEMENTED-UNCONNECTED, never functional pass.
> Existing required migrations need review; propose revised SQL, do not apply
> production schema. No publish, real outbound message, payment, mailbox scope
> expansion or production trigger activation. Implement independent work despite
> blocked dependencies. Do not invent team acceptance or claim100%.
>
> ROUND R1/5: Make preparation execution safe and connectable.
> Codex inspected preparation-runner.server.ts: existing result returned before
> verifyAccess; store.load/save is not atomic claim; counts are read before
> execution; currentInputRevision and policy passed in once; timeout timer not
> cleaned on success; SQL freezes finished_at/model_use while recovery reuses
> row. Only sandboxStore implements PreparationStore. These are code findings,
> not observed exploits.
> R1.1 Check active workspace and subject access before loading/returning any
> cached output or writing refusal; unauthorized attempts cannot mutate another
> person's run.
> R1.2 Implement real server-only database adapter plus atomic scoped claim with
> bounded lease/recovery, attempt identity and quota reservation; simultaneous
> duplicate events invoke model at most once per claimed attempt. Concurrent
> distinct jobs cannot overrun workspace limit. Do not assume unique insert alone
> handles retries.
> R1.3 Reload policy/stop/access/current source revision at appropriate claim and
> completion boundaries; changed inputs never become current prepared work; no
> endless running row after worker crash. Bounded retry reconciles unknown model
> outcome instead of blind retry.
> R1.4 Align SQL lifecycle with retries: preserve attempt/provenance history while
> permitting permitted recovery; freeze request identity incl requester and output
> content once finalized, owner uses verified membership ID not label alone. Check
> same-workspace subject binding. Explicitly test failed-run→retry→success and
> immutable finished evidence. Revise proposed SQL with minimal grants/RLS and no
> production application.
> R1.5 Clean timeout/abort listeners on all outcomes; persist provider/model/
> instructions version or content hash/input revision and honest usage;
> receipt-save failure must not claim persisted success.
> R1.6 Boundary tests cover cached access revocation, wrong workspace,
> concurrency, quotas, crash recovery, failed saves, mid-run revision/policy
> changes, retry vs SQL constraints. Run database integration tests on disposable
> local/test DB if available; otherwise mark SQL execution unverified. Map
> remaining dependency gaps precisely.

### Changed files

| File | What it is now |
| --- | --- |
| `src/domain/preparation-claim.ts` (new) | The pure claim rule: lease, recovery, attempt bound. No clock, no storage. |
| `src/domain/preparation-claim.test.ts` (new) | 9 tests over that rule. |
| `src/domain/preparation-jobs.ts` | Output record gains `attemptId`, `leaseUntil`, `persisted`, `ownerMembershipId`; `ModelUse` gains `instructionsHash` and `inputRevision`. |
| `src/lib/preparation-runner.server.ts` | Reordered and hardened: access first, atomic claim, limits twice, finish-boundary rechecks, deadline cleanup, honest receipts. |
| `src/lib/preparation-store.server.ts` (new) | The real server-only adapter over `preparation_outputs` and `preparation_attempts`. |
| `src/lib/preparation-policy.server.ts` (new) | Reads `preparation_policy`. Absent means everything off; unreadable is a refusal, never an empty policy. |
| `src/lib/preparation-subjects.server.ts` (new) | Registry of per-job subject readers. Empty by design; a job with no reader refuses. |
| `src/routes/api/public/preparation.run.ts` (new) | The route an event handler or a person calls. Bearer proved, policy read, real store used. |
| `src/data/fixtures/preparation-sandbox.ts` | Sandbox store now implements the same claim rule as the adapter. |
| `src/lib/preparation-boundaries.server.test.ts` (new) | 13 boundary tests: revoked access, wrong workspace, concurrency, quotas, crash recovery, failed saves, mid-run changes. |
| `src/lib/preparation-runner.server.test.ts`, `src/lib/enquiry-preparation.server.test.ts` | Updated to the new store contract and the throwing access refusal. |
| `docs/migrations/proposed/20260916170000_preparation_outputs_r1.sql` (new) | Revised proposal. Supersedes the unapplied `20260916130000` draft. |

### Route to service to record

```text
POST /api/public/preparation/run          src/routes/api/public/preparation.run.ts
  -> bearer token required                 (no token, no run, 401)
  -> subjectReader(jobId)                  src/lib/preparation-subjects.server.ts
       (no reader registered yet -> 501, nothing written)
  -> loadPreparationPolicy()               src/lib/preparation-policy.server.ts
       -> table preparation_policy         (absent row = everything off)
  -> runPreparation()                      src/lib/preparation-runner.server.ts
       -> verifyAccess / verifySubject     (refusal throws, writes nothing)
       -> preparationStore().claim()       src/lib/preparation-store.server.ts
            -> table preparation_outputs   (insert, or compare-and-swap)
            -> table preparation_attempts  (one row per attempt, append only)
       -> runtimeModelCaller()             src/lib/intelligence-runtime.server.ts
       -> preparationStore().complete()    -> table preparation_outputs (by attempt_id)
```

### Acceptance rows

| # | Criterion | Result | Evidence level | Evidence | Owner | Next action |
| --- | --- | --- | --- | --- | --- | --- |
| R1.1 | Access and subject checked before any cached output is read, returned or refused; unauthorised attempts mutate nothing | PASS | CODE | `runPreparation` proves access and subject binding before `store.load`. Tests: cached answer not returned after revocation and `load` never called; wrong-workspace subject leaves the store empty; a load scoped to another workspace returns null. | Lovable | None |
| R1.2a | Real server-only database adapter exists | PASS (unwired to real subjects) | IMPLEMENTED-UNCONNECTED | `src/lib/preparation-store.server.ts`, service credentials only, organization filter on every statement. Cannot be exercised: its tables are not in the database. | Codex (SQL), Lovable | Apply the revised SQL, then run a persisted check |
| R1.2b | Atomic scoped claim with bounded lease, recovery and attempt identity | PASS | CODE + SYNTHETIC | `claimDecision` plus insert-or-compare-and-swap in the adapter; sandbox implements the same rule. Two simultaneous identical events: model called once, one record, the loser told it is running. | Lovable | Confirm the swap against a real database |
| R1.2c | Concurrent distinct jobs cannot overrun the workspace limit | PASS | CODE | Limits are read before the claim and again after it; a run that only went over after claiming is stopped before the model is called. | Lovable | None |
| R1.3a | Policy, stop switch, access and subject revision re-read at the finish | PASS | CODE | Three tests: revision moved mid-run, stop switch flipped mid-run, access ended mid-run. None becomes current prepared work. | Lovable | None |
| R1.3b | No endless running row after a worker crash | PASS | CODE | Bounded lease; within it another attempt is refused, past it the work is picked up as attempt 2. | Lovable | None |
| R1.3c | An unknown model outcome is reconciled, never blindly retried | PASS | CODE | Timeout records `uncertain`; `claimDecision` refuses to claim it and `retryDecision` refuses to retry it. | Lovable | None |
| R1.4a | SQL lifecycle allows permitted recovery while preserving attempt history | PASS | SQL-UNVERIFIED | `preparation_attempts` is append only; the output guard reopens a finished row only for a new attempt id with a fresh lease and a higher attempt number. | Codex | Review and apply |
| R1.4b | Request identity, including requester, frozen; finished evidence immutable outside a new attempt | PASS | SQL-UNVERIFIED | `preparation_outputs_guard`. | Codex | Review and apply |
| R1.4c | Owner recorded as a verified membership id, not a label alone | PASS | SQL-UNVERIFIED + CODE | `owner_membership_id` with a same-workspace check in `preparation_outputs_binding`; `ownerMembershipId` carried through the read and the adapter. No room supplies it yet. | Lovable | Rooms to supply the membership id in their subject readers |
| R1.4d | Same-workspace subject binding checked | PARTIAL | CODE + SQL-UNVERIFIED | Code refuses through `verifySubject`; SQL binds requester and owner to the workspace. The subject itself cannot be bound in SQL until each room names its subject table. | Lovable | Bind per-room subject tables when the readers land |
| R1.4e | failed run → retry → success tested explicitly | PASS | CODE | Crash recovery test runs attempt 1 to a dead end and attempt 2 to prepared, attempt count 2, one record. | Lovable | Repeat against a real database once applied |
| R1.5a | Timeout and abort listeners cleaned on every outcome | PASS | CODE | `callWithDeadline` clears the timer and removes the abort listener in `finally`. | Lovable | None |
| R1.5b | Provider, model, instructions hash and input revision persisted; usage honest | PASS | CODE | `modelUse` carries a SHA-256 of the exact instructions and the revision; an unreported token count stays absent rather than becoming zero. | Lovable | None |
| R1.5c | A failed save never claims persisted success | PASS | CODE | `settle` returns `persisted: false` and says the record was not saved. | Lovable | None |
| R1.6a | Boundary tests for revocation, wrong workspace, concurrency, quotas, crash recovery, failed saves, mid-run changes | PASS | CODE | `src/lib/preparation-boundaries.server.test.ts`, 13 tests. | Lovable | None |
| R1.6b | Database integration tests on a disposable database | NOT PERFORMED | SQL-UNVERIFIED | No disposable Postgres is available in this environment, and the production schema must not be touched. No SQL in this round has been executed anywhere. | Codex | Apply the revised SQL on a review database and run a persisted check |
| R1.6c | Remaining dependency gaps mapped | PASS | DOC | See below. | Lovable | Carry into R2 |
| R1.7 | Nothing published, sent, paid, widened or switched on | PASS | CODE | No send, publish, payment or schedule code touched. Every job still ships off; the policy default is an empty enabled list. | Lovable | None |

### Dependency gaps, precisely

1. **Subject readers.** `src/lib/preparation-subjects.server.ts` has no entries.
   Until a room registers one, the route answers 501 and prepares nothing. This
   is the single thing between the route and a real prepared record. Owner:
   Lovable, next round.
2. **Schema.** `preparation_outputs`, `preparation_attempts` and
   `preparation_policy` do not exist in `okydosoacqdnursmmenf`. The adapter and
   the policy reader both refuse honestly when they are missing. Owner: Codex.
3. **Model provenance.** No real model has run through this path, so reported
   usage and cost are still unobserved. Owner: Lovable, once a reader and the
   schema exist.
4. **Live evidence.** No signed-in session is available here, so nothing in
   this round is LIVE. Owner: Codex.
5. **Team acceptance.** Not claimed, not claimable here.

### Preserved

Comms work, and the C01 to C22, T01 to T05, P1 to P8 and A criteria records,
are untouched by this round. No Comms file was edited. Nothing previously
blocked has been advanced or waived.
