# Scout People persistence readiness

Build: local preview, external Supabase project `okydosoacqdnursmmenf`.
Schema state: `public.scout_people` DOES NOT EXIST. The revised proposal at
`docs/migrations/proposed/20260916180000_scout_people.sql` is NOT APPLIED. This
runtime holds no credential able to change database structure; Codex applies it.

Evidence labels used below:
- CODE — deterministic test or source proof in this repository.
- USER-REPORTED — reported by Tai or by this assistant's runtime, not
  independently verified by Codex.
- BLOCKED — cannot be performed until the migration is applied.
- PENDING-TAI — waits on Tai's signed-in acceptance.

## SP1 Membership must literally be active

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP1.1 | Every policy in the revised migration reads `m.status = 'active'`; no `coalesce(status, 'active')` remains | CODE — migration file, `rg coalesce` returns nothing | PASS |
| SP1.2 | Missing, blank, invited or suspended membership is refused at the server boundary | CODE — `requireActiveMember` in `src/lib/context-packet.server.ts` compares `status === "active"` | PASS |
| SP1.3 | Membership alone does not grant write or delete: `authenticated` holds SELECT only; writes run through the server after an active membership AND a writing role (`owner`, `admin`, `member`) | CODE — migration grants; `WRITING_ROLES` and `canWrite` in `context-packet.server.ts`; route `WRITE_ACTIONS` gate | PASS |
| SP1.4 | Database-level refusal of a non-active member | BLOCKED — needs the applied table | BLOCKED |

## SP2 Same-workspace bindings and unforgeable verification

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP2.1 | Prospect, contact and Comms relationship must belong to the same workspace; enforced by trigger `scout_people_same_workspace()` (those tables carry single-column primary keys, so a composite foreign key is unavailable without adding unique constraints to them) | CODE — migration | PASS (apply pending) |
| SP2.2 | Same-workspace check also enforced at the server boundary before any write | CODE — `assertProspect` in `src/lib/scout-people-store.server.ts`; test "refuses a company from another workspace" | PASS |
| SP2.3 | Identity frozen after insert: organization, prospect, provider, match kind and value, `created_by`, `created_at`; a provider person id, once set, cannot change | CODE — migration trigger `scout_people_freeze_identity()` | PASS (apply pending) |
| SP2.4 | `created_by` stamped from the verified actor, never from the request body | CODE — route passes `caller.userId`; test "stamps the verified actor and never an address" | PASS |
| SP2.5 | UPDATE policy states both USING and WITH CHECK | CODE — migration | PASS (apply pending) |
| SP2.6 | Grants minimal: `REVOKE ALL` from PUBLIC, anon and authenticated first; `authenticated` SELECT only; `service_role` SELECT, INSERT, UPDATE. No GRANT ALL, no DELETE or TRUNCATE for any application role | CODE — migration | PASS (apply pending) |
| SP2.7 | Provenance bounded to a json object of at most 8192 bytes | CODE — migration constraint | PASS (apply pending) |
| SP2.8 | Verification state and timestamps must agree: no address means `not_checked`/`not_found` with no verification time; `found_unverified` carries a fetch time only; `verified` carries both | CODE — migration constraint `scout_people_email_state_agrees` | PASS (apply pending) |
| SP2.9 | The browser cannot forge a verified Apollo result: the save path strips address, status and verification fields, and only `storedEmailFacts` (derived from the provider answer) can write them | CODE — `savableResearch` test "drops a forged address and verification a browser sent"; store tests on `recordEmail` | PASS |

## SP3 Durable adapters and interface built now

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP3.1 | Server store implemented against the proposed table | CODE — `src/lib/scout-people-store.server.ts` | PASS |
| SP3.2 | Missing table reported as an explicit unavailable state, not a crash: store raises `ScoutPeopleSchemaUnavailable`, the route answers 503, the People card says people stay for this visit only | CODE — store test "reports a missing table as a gap, not a failure"; `storageUnavailable` panel in `src/components/tt/scout/detail/people-section.tsx` | PASS |
| SP3.3 | Saved research carries provider person id, buying role, reason, provenance and discovery time | CODE — store `saveResearch` row mapping | PASS |
| SP3.4 | Email result saved with provider, provider-reported verification status and fetch time | CODE — `recordEmail` tests | PASS |
| SP3.5 | A failed write keeps the rows on screen and offers a retry; nothing claims "saved" before a successful write | CODE — store test "says a write failed rather than reporting a save"; `saveProblem` panel with "Try saving again"; per-row "saved" / "not saved yet" label | PASS |

## SP4 Reopen, dedupe and no paid lookup on reload

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP4.1 | A signed-in company page reads persisted people first and merges unsaved session rows behind them | CODE — `persistedPeople` query and `peopleForCard` in `src/routes/modules.scout.prospects.$prospectId.tsx` | PASS |
| SP4.2 | Reading saved people calls no provider and spends nothing | CODE — store test "reads saved people without touching any provider"; the list action is separate from discover/enrich | PASS |
| SP4.3 | Dedupe is atomic: one upsert on `(organization_id, prospect_id, provider, match_kind, match_value)`; a concurrent duplicate resolves by re-reading, not by inventing a second row | CODE — store test "lets two concurrent saves settle in the database, not in the app" | PASS |
| SP4.4 | Matching without a provider id falls back to professional address, then profile url, then a manual key. Two people with the same name never auto-merge | CODE — `identityKey` and `canAutoMatch` tests | PASS |
| SP4.5 | Re-enrichment updates the same record with honest provenance rather than adding a row | CODE — `recordEmail` targets the stored id | PASS |
| SP4.6 | Retrying a failed save performs no paid lookup | CODE — retry calls `saveResearch` with the rows already on the page | PASS |
| SP4.7 | Reload actually returns the person on a live signed-in page | BLOCKED — needs the applied table | BLOCKED |

## SP5 Comms handoff

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP5.1 | Handoff uses the selected persisted person, their company, the actual work email and the recorded reason | CODE — `prepareOutreach` in the prospect route, `recordPersonHandoff` | PASS |
| SP5.2 | Handing the same person over twice returns the first conversation; the winner of a race is kept | CODE — store test "returns the first conversation when the same person is handed over twice" | PASS |
| SP5.3 | Two different people at one company stay distinct records and existing client facts are not overwritten | CODE — identity key includes the person, not the company; handoff writes only the relationship link | PASS |
| SP5.4 | Selecting a person is not send approval; nothing sends | CODE — the handoff creates a Comms relationship and review only; no send path is touched | PASS |

## SP6 Tests and remaining verification

Deterministic suites added this round:
- `src/domain/scout-people-persistence.test.ts` — 8 tests.
- `src/lib/scout-people-store.server.test.ts` — 9 tests.

Covered: wrong-workspace reference, missing table, forged verified status,
duplicate concurrent save, failed write, idempotent handoff, reload read with no
provider call, name-only non-merge. Inactive membership and unauthorized role
are covered at the server boundary by `requireActiveMember`.

Database integration checks prepared for Codex, to run after the migration:
1. Insert as a non-active member — expect refusal.
2. Insert a prospect id from another organization — expect the trigger to refuse.
3. Update `organization_id`, `prospect_id` or `provider_person_id` on an existing row — expect refusal.
4. Insert `email_status = 'verified'` with no address — expect the check constraint to refuse.
5. Attempt DELETE or TRUNCATE as `authenticated` and as `service_role` — expect refusal.
6. Two concurrent identical upserts — expect one row.

## Live evidence separation

- The Apollo people search and the single work-email lookup for Acumen
  Technology are USER-REPORTED (this runtime), NOT independently verified by
  Codex, and are separate from durable persistence.
- Durable persistence has no live evidence at all yet, because the table does
  not exist.
- Tai's signed-in acceptance of the People card, saving, reload, handoff and
  cross-organization privacy remains PENDING-TAI.

## SP7 Enrichment result and persistence are separate (2026-09-16)

The card previously contradicted itself: a person could read "Apollo reported
verified" above "NOT FOUND, not saved yet". The cause was three separate
mistakes, all corrected here.

| # | Row | Evidence | Result |
| - | --- | -------- | ------ |
| SP7.1 | One person-scoped lookup updates the shown address, provider state and timestamp immediately, whether the person is saved, session-only, or both | CODE — `mergePeople` in `src/domain/scout-people-overlay.ts`; tests "shows a new answer on a person who exists only in storage" and "lays a newer lookup over a stale saved version" | PASS |
| SP7.2 | A newer unsaved answer overlays an older saved one; an older answer never hides a newer saved one | CODE — overlay compares the checked time; test "never lets an older answer hide a newer saved one" | PASS |
| SP7.3 | Identity is workspace, company, provider person id, address or profile, or a stable manual key, never a name | CODE — `personIdentity` over `identityKey`; test "does not merge two different people who share a name" | PASS |
| SP7.4 | Provider success and storage failure are separate in the response and on screen: "Address found. Not saved yet." plus the real save error | CODE — `EnrichResult { person, pending, persisted }`; the provider sentence is shown as `pendingNote`, never as the failure | PASS |
| SP7.5 | "Verified" comes only from the server-trusted provider answer; "not found" only from a genuine provider no-result | CODE — `storedEmailFacts` on the server; the browser sends no address or status | PASS |
| SP7.6 | Retrying the save stores the exact trusted answer with zero Apollo or Clay calls | CODE — server-held receipt (`src/lib/scout-enrichment-receipts.server.ts`) and the `save-email` action, which calls no provider; receipt tests, 4 | PASS |
| SP7.7 | The held answer expires honestly: 30 minutes, in memory, lost on a server restart, and the button is replaced by an explanation when no receipt is available | CODE — `RECEIPT_TTL_MINUTES`, `receiptUsable`, 410 `receiptExpired` from the route, and the card copy | PASS |
| SP7.8 | The address stays visible after a failed save, and a result already obtained does not offer a paid lookup again | CODE — the overlay survives the failure; the row's next action becomes outreach once an address is present | PASS |
| SP7.9 | No claim of "nothing was lost" while the result is volatile; session-only is stated plainly | CODE — the card now says the result lives on this page only and a reload loses it | PASS |
| SP7.10 | `public.scout_people` is still absent, so saving fails explicitly rather than looping | CODE + CODEX — confirmed absent at fd0b7f9; storage-unavailable state hides the save button and explains why | PASS |
| SP7.11 | Signed-in browser proof of the corrected card | BLOCKED — no authenticated session available in this runtime | BLOCKED |

Files changed: `src/domain/scout-people-overlay.ts` (new),
`src/domain/scout-people.ts`, `src/lib/scout-enrichment-receipts.server.ts`
(new), `src/routes/api/public/scout.people.ts`,
`src/data/scout/people-research.ts`,
`src/routes/modules.scout.prospects.$prospectId.tsx`,
`src/components/tt/scout/detail/people-section.tsx`, plus
`src/domain/scout-people-overlay.test.ts` and
`src/lib/scout-enrichment-receipts.server.test.ts`.

Proof this round: 11 new tests; full suite 306 files, 3,409 tests passed; types
clean; preview build OK. No Apollo or Clay call was made, no credit was spent,
no message was sent, and no schema was applied. The remaining database
dependency is unchanged: Codex must apply the revised
`docs/migrations/proposed/20260916180000_scout_people.sql` before reload
persistence, cross-organization refusal and durable save can be demonstrated.

## SP8 Automatic save after a lookup (Robin Shah / Thyme Care report)

Root cause of the reported state: the enrichment route only wrote the answer to
a person who already had a durable row. A person found in this visit fell to a
held-result path, so a successful Apollo lookup rendered as an unsaved result
with a second Save button and implementation language (TTL, server restart).
The missing title was a second, separate defect: Apollo's `bulk_match` response
carries `title`/`id`, and the adapter discarded both.

| # | Evidence | Result |
|---|---|---|
| SP8.1 | `enrichWorkEmail` returns `title`, `fullName`, `providerPersonId` from the match | PASS-CODE (`src/lib/contact-enrichment.server.ts`, test "keeps the title and person id the match states") |
| SP8.2 | Enrich route records the person then the answer when only `prospectId` is known, so the normal path needs no second click | PASS-CODE (`src/routes/api/public/scout.people.ts`) |
| SP8.3 | Save failure states "Email found, but Scout could not save it yet." with a free retry; no TTL or restart wording anywhere in the UI | PASS-CODE (`src/components/tt/scout/detail/people-section.tsx`) |
| SP8.4 | Retry still spends nothing: it posts `save-email` with the server-held receipt, never the provider | PASS-CODE (unchanged receipt path) |
| SP8.5 | Overlay fills a missing title/provider id from the match and never overwrites a known one | PASS-CODE (`src/domain/scout-people-overlay.test.ts`) |
| SP8.6 | Missing title reads "Title unavailable" | PASS-CODE |
| SP8.7 | Full suite 3,411 passed, types clean, build OK | PASS-CODE |
| SP8.8 | Automatic save proven against a real row | BLOCKED - `public.scout_people` still absent; Codex must apply `docs/migrations/proposed/20260916180000_scout_people.sql` |
| SP8.9 | Signed-in Thyme Care / Robin Shah screen acceptance | PENDING - user |

No Apollo call, no credit, no send, no schema application in this round.
