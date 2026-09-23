# Scout x Steward AI: live queue, campaigns, scout profiles, send-triggered agent

Standing rules still apply: the AI never sends, publishes, approves or commits. Every outbound message goes through the existing Comms review and a human send click. Any new tables are proposed SQL for Codex, never applied by me. Live checks need a signed-in session; without one they are recorded as blocked, never passed.

"Scout profile" here means one Scout company (prospect) plus its saved People, tasks and agent runs. It does not mean a new kind of person record.

---

## 1. Live queue on the AI page, shown in the AI feed and the Scout task on Home

Options: (a) a manual click-through only, (b) a mocked run in tests, (c) seed a run row directly, (d) run with the service key, (e) extend the reusable signed-in walkthrough to queue a task, wait for the run to settle, then check the AI feed and the Home row.
**Chosen: (e).** It repeats reliably, uses the real path and doesn't impersonate anyone.
Dependencies: a fresh sign-in link from you, plus Codex applying `steward_agent_runs_and_source_links`. If either one is missing, the script names that single blocker and stops.

Acceptance
- L1 A task queued on the AI page shows as Queued, then In progress, then Completed or Needs approval, with timestamps.
- L2 The same run shows in the Home AI feed and is marked as agent work, not human work.
- L3 If the task is linked to Scout, its row on Home shows the agent's status, and it is checked and crossed out only when completed with evidence.
- L4 Reloading the page keeps everything. Test rows are deleted afterwards and the session is thrown away.

## 2. Scout outreach campaign from a People row

Options: (a) use a third-party sequencer, (b) a new campaign app, (c) keep drafts in local storage, (d) let the agent send automatically on a schedule, (e) a campaign that lives inside the existing Scout Outreach page. It holds a template and a list of saved People, the agent prepares one Comms draft per person, and a send queue lists each draft waiting for your approval.
**Chosen: (e).** It reuses Comms drafts, review, approval and delivery idempotency, so there is no parallel CRM. "Send" means you approve each queued draft, or approve a batch by ticking several and confirming. The agent drafts but never sends.

Acceptance
- C1 You can create a campaign from a People row or from Outreach with a name, a template using {first_name}, {title} and {company} placeholders, and chosen recipients. Only verified or accepted work emails are allowed.
- C2 Preparing creates one Comms draft per recipient, and each draft is linked to its Scout task.
- C3 The send queue shows each draft as Drafting, Needs review, Approved, Sent or Failed. Nothing sends until a person approves it.
- C4 Placeholders that can't be filled block the draft with a clear reason. The draft is never sent with blanks.
- C5 Duplicate recipients and re-preparing don't create duplicate drafts or sends.
- Storage: proposed `scout_campaigns` and `scout_campaign_recipients` tables for Codex, with RLS by organization and active membership. Until they exist, the page says campaigns can't be saved yet.

## 3. Scout dashboard in Steward

Options: (a) link out to Scout, (b) a combined table on Home, (c) a Scout section in Tasks, (d) a new top-level app, (e) a Steward "Scouts" tab laid out like People. It shows a card per profile with its People count, open, done and approval-needed tasks, and the latest agent run, and each card opens the profile.
**Chosen: (e).** It matches the familiar People layout and reads existing data only.

Acceptance
- D1 The list shows every Scout profile in the organization with accurate counts. Unknown values show as "Not recorded", never 0.
- D2 Filters for stage, has open tasks and agent status are applied before pagination, 12 per page.
- D3 Each card opens the profile. Actions (assign, queue AI) use the existing drawers.

## 4. Real scout profile with its own tasks, used by the agent

Options: (a) a static summary page, (b) a new profile table, (c) letting the agent search freely, (d) embeddings over all data, (e) a profile page built from canonical records (prospect, ICP fit, saved People, linked tasks, runs, Comms history), plus a "Ask about this company" box that queues an agent task linked to that prospect.
**Chosen: (e).** There is no duplicate entity. The agent's existing People context is extended with prospect facts and recent Comms, and every name or fact it states must cite a loaded record.

Acceptance
- P1 The profile shows company facts, People (up to 4 recommended), its tasks with status, the run history and the Comms thread links.
- P2 A question asked on the profile creates a linked Steward task and an agent run. The answer cites saved People and prospect fields, and invented names are rejected.
- P3 Missing data is shown as unknown, and the agent says it doesn't know instead of guessing.

## 5. Comms send triggers the agent on the Scout task

Options: (a) only mark it complete (today), (b) a database trigger, (c) a scheduled sweep, (d) the agent starts a new outreach automatically, (e) after a recorded send, the shared settle step completes the first-message task and creates an exact follow-up task ("Prepare follow-up for <person>"). It is assigned to the AI, which prepares an internal follow-up draft or plan that waits for your review.
**Chosen: (e).** It uses the same exact linkage key, is idempotent per delivery, and is internal work only.

Acceptance
- S1 Only a delivery marked `sent` and linked to that prospect triggers it. There is no fuzzy matching.
- S2 The first-message task is checked and crossed out, and one follow-up task is created and runs once, even if the same delivery is retried.
- S3 The agent output is a draft or plan marked Needs approval. It never sends.
- S4 If the agent can't start, the completion still stands and the follow-up shows "AI work did not start".

---

## Technical details
- Walkthrough: extend `scripts/qa/home-e2e.py` with AI-queue and feed checks.
- Campaigns: domain logic in `src/domain/scout-campaign.ts`, a server store and an authenticated route, UI in `modules.scout.outreach.tsx` plus a People-row action. Drafts are made through the existing Comms draft service.
- Scouts tab: `modules.steward.scouts.tsx`, reading from the prospects, steward tasks and agent-runs reads. New tab in `steward-tabs.tsx`.
- Profile: extend `modules.scout.prospects.$prospectId.tsx`. Add `src/domain/steward-agent-prospect-context.ts` and wire it into the runner with citation validation.
- Send hook: extend `completeScoutTaskAfterSentDelivery` with idempotent follow-up creation using key `scout:prospect:<id>:follow-up:<deliveryId>`, then dispatch the runner.
- Proposed SQL: `docs/migrations/proposed/<ts>_scout_campaigns.sql` (Codex).
- Verification: unit and mocked tests for every acceptance row, the full suite, type checks and the signed-in walkthrough. Rows are recorded as CODE, LIVE or BLOCKED in `docs/steward-bounded-agent-and-scout-send.md`.
