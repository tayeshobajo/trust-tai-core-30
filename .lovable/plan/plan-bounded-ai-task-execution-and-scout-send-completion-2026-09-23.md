# Plan: Bounded AI task execution and Scout-send completion

## Goal

Turn Steward’s existing agent assignment into real, evidence-backed internal work, and close the exact Scout-originated Home task when its approved Comms message is confirmed sent.

The selected operating model is:

- **Scope:** explicitly delegated tasks plus authorised recurring internal-preparation rules.
- **Start:** an eligible task starts when a person assigns it to an AI teammate.
- **Completion:** low-risk internal work may complete with durable evidence; higher-risk work stops at **Needs approval**.
- **Hard boundary:** the agent cannot send messages, publish, approve itself, change prices/scope/dates, make commitments, or expand its own access.

## Current state confirmed

- `steward_tasks` is already the durable manual task source and supports human/agent ownership, AI modes, progress states, Paperclip IDs, and correlation IDs.
- Steward Tasks already has an **Agents** filter, while Steward Agents already shows each agent’s active work and activity. A second task store or top-level app is unnecessary.
- Assignment to an existing agent creates an idempotent Paperclip issue, but creating a task directly as AI-owned still contains a TODO and does not dispatch real work.
- Home’s AI activity feed now filters to explicit agent provenance, but no current Steward writer emits a completed internal-agent activity.
- Existing preparation code has leases, limits, revision checks, provenance, and fail-closed policy, but its persistence migration remains proposed and its current jobs are not a general Steward task executor.
- Gmail and Resend sends use one approval authority and durable delivery receipts. Neither send path currently completes a linked Scout/Home task.
- Scout-to-Comms identity is durable through `comms_relationships.prospect_id`; `steward_tasks` has no canonical Scout source-link fields today, so title/person matching would be unsafe.

## Product flow

```text
Person assigns eligible task to AI
  -> one durable run is claimed
  -> agent reads only the task’s approved internal context
  -> agent produces a bounded artifact with evidence and provenance
  -> low risk: task completes
     higher risk: task becomes Needs approval
     failure/denial: task stays open with an honest state
  -> Steward Agents shows its queue and result
  -> Home AI activity shows the verified agent event

Person approves and sends a Scout-originated Comms draft
  -> provider confirms sent and delivery receipt settles
  -> canonical relationship -> prospect -> linked Steward task resolves
  -> exact linked task completes once
  -> Home shows a checked, crossed task
```

## Build steps

### 1. Canonical task linkage and durable run receipts

Prepare one additive migration for Codex review; do not apply it here.

- Add canonical source fields to `steward_tasks`: source app, source entity type, and source entity ID.
- Add a workspace-scoped uniqueness rule for one canonical task per source identity where appropriate.
- Add `steward_agent_runs` as an execution-receipt ledger, not a second task store: task ID, agent ID, risk decision, status, attempt/lease, model/run provenance, evidence refs, artifact, safe error, timestamps, and idempotency key.
- Add a small workspace agent policy row for enabled state, stop switch, daily limit, and approved recurring rule IDs; default everything off except person-triggered assignment.
- Use literal active membership checks, same-workspace foreign keys/triggers, narrow grants, RLS, immutable settled receipts, and revoked direct function execution.
- Keep recurring scheduling unactivated; approved recurring rules may be represented and viewed, but no production schedule is enabled in this work.

### 2. One bounded Steward agent runner

- Add one server-side runner invoked by the existing assignment flow after the task and assignment receipt are durable.
- Use the existing intelligence boundary with the assigned model `openai/gpt-6-astra` on the streaming Responses API, medium reasoning, stateless history, and server-only credentials.
- Classify the task deterministically before model use. Only internal preparation from task-provided and workspace-authorised context is executable.
- Supported first-release output is a saved internal artifact: concise summary, checklist, research synthesis from supplied evidence, or draft material that remains inside Trust Tai.
- Require evidence references and acceptance-criteria checks before completion.
- Low-risk, reversible preparation may settle the task as complete. Anything involving external action, commitment, approval, pricing, scope, date changes, insufficient evidence, or uncertain impact settles as `needs_approval` or `blocked` without performing the action.
- Claim each run atomically and idempotently. Concurrent assignment/clicks produce one run. Failed persistence never reports success.
- Apply gateway error rules: safe provider message in the UI; only bounded delayed retries for 429/5xx; terminal 400/401/provider denial/refusal; durable pause for credit/policy blocks; no model/provider substitution.
- Do not give the model mutation tools. Code, not the model, owns the only allowed writes: run receipt, internal artifact, task state, and activity event.

### 3. Steward agent task experience

- Keep the existing Steward navigation and task store.
- Make **Agents** in Steward Tasks the AI teammate’s task list, with queued, working, needs approval, blocked, and completed sections plus pagination.
- In Steward Agents, show the same durable runs and artifacts alongside Paperclip work, clearly identifying the execution source.
- Fix direct “Create and assign to AI” so it uses the same assignment-and-run path rather than only showing a queued toast.
- Show progress, Stop where cancellation is still safe, Retry only where policy permits, evidence, completion criteria, and the saved output.
- Emit append-only activity with structural agent provenance, task/run IDs, evidence refs, reversible flag, and minutes saved only when actually known.
- Home continues to show only verified agent-authored events; no human activity is relabelled.

### 4. Complete the exact Scout task after a confirmed send

- When Scout creates or hands off outreach work, persist the canonical source link on the existing Steward task; never infer by person, title, or company name.
- Add one idempotent post-send completion service used by both Gmail and Resend.
- Invoke it only after a provider-confirmed `sent` result and a settled delivery receipt. `failed`, `unknown`, `attempting`, and readiness checks never complete a task.
- Resolve within the same organization: draft -> relationship -> `prospect_id` -> canonical linked Steward task.
- Mark only the linked, still-open Scout task complete and append an observed Comms-owned activity carrying delivery ID, provider message ID, draft ID, prospect ID, and task key.
- Replayed sends and duplicate callbacks return the already-completed state without another task transition or activity row.
- If the provider sent but the task-completion write fails, preserve the send result, show an honest follow-up warning, and allow an idempotent reconciliation without resending.
- Home’s existing completed rendering supplies the check mark, crossed title, Complete label, and disabled repeat action after refresh.

### 5. Verification and documentation

- Document the agent scope, supported tasks, risk matrix, provenance, stop controls, safe error behavior, recurring-rule inactive state, and Comms-to-Scout completion contract.
- Record code, mocked-provider, database, and signed-in browser evidence separately. Do not claim live completion before Codex applies the migration and an authenticated workflow passes.

## Acceptance criteria

### Agent execution

- **AE1** Assigning one eligible task starts exactly one durable run; concurrent attempts do not duplicate model work.
- **AE2** The agent reads only same-workspace, explicitly authorised task context and records every input reference.
- **AE3** A low-risk internal task completes only after its artifact is durably saved and acceptance criteria pass.
- **AE4** Higher-risk or ambiguous work becomes Needs approval without performing the consequential action.
- **AE5** Missing evidence, read failure, write failure, cancellation, refusal, credit block, and provider denial are distinct honest states; none is shown as complete.
- **AE6** 400/401/402/403/provider refusal are not retried; 429/5xx use bounded delayed retry only; no model or provider substitution occurs.
- **AE7** No agent path can call Comms send, publish, approve, pay, change price/scope/date, or widen access.
- **AE8** Direct AI task creation and later reassignment use the same runner and retain task identity across reloads.
- **AE9** Steward Tasks’ Agents view and Steward Agents show the AI’s real queued, working, review, blocked, and completed tasks with artifacts and evidence.
- **AE10** Home AI activity is backed by append-only agent provenance and never includes ordinary human actions.
- **AE11** Workspace stop and daily limits fail closed; recurring schedules remain inactive.

### Scout -> Comms -> Home

- **SC1** A Scout-originated outreach task carries a durable canonical prospect source link.
- **SC2** Only a confirmed `sent` delivery with a settled receipt can complete it.
- **SC3** Failed, unknown, blocked, readiness-only, or abandoned sends leave the task open.
- **SC4** Completion resolves by organization + canonical prospect/task identity, never fuzzy matching.
- **SC5** Gmail and Resend both use the same completion service.
- **SC6** A replay or concurrent callback produces one completion and one activity event.
- **SC7** If the message sent but completion persistence failed, the user is warned and reconciliation cannot resend the message.
- **SC8** Reloading Home shows the task checked, crossed out, labelled Complete, and impossible to complete again.
- **SC9** Wrong-workspace, unrelated-prospect, absent-link, and already-complete cases cannot mutate another task.

### Proof

- **VP1** Deterministic tests cover risk classification, evidence gates, idempotent claims, concurrent starts, completion, review, cancellation, and all gateway status classes.
- **VP2** Adapter tests use mocked AI responses; one controlled live gateway call through the real route verifies protocol and error handling after code is ready.
- **VP3** Integration tests cover both send providers, every non-sent state, replay, missing link, wrong workspace, completion-write failure, and reconciliation.
- **VP4** Component tests cover the Agents task list, real agent activity, Needs approval, checked/crossed Scout completion, pagination, and keyboard access.
- **VP5** Full tests, type checks, build, and patch checks pass.
- **VP6** Codex reviews/applies the additive SQL once; live RLS, concurrency, reload, and signed-in end-to-end evidence remain blocked until then and are never inferred from mocks.

## Non-goals

- No autonomous external send, outreach, publication, payment, commitment, pricing, scope, or date decision.
- No second CRM, approval queue, top-level app, or duplicate task store.
- No production schedule activation, schema application, deployment, or real customer task execution in this build.
- No claim that Paperclip completed app-run work, or that app-run work came from Paperclip.
