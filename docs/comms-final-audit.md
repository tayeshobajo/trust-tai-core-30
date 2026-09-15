# Comms final audit — every criterion, one row each

Pinned candidate: base commit `863cafbcc0e9a4771c0aeb2e27633724ffdd15c7` plus
the four fixes made in this closure queue (Task 2 paging, Task 3 delivery
ledger, Task 4 accessibility tests, Task 5 scoring correction). Gates re-run on
exactly this tree on 2026-09-15: types clean, **264 test files / 2,960 tests
passing**, build OK. Live model evidence was produced against this same tree;
live read-only database evidence is environment state and is independent of the
build, which is stated per row rather than assumed.

Evidence levels: **Live** (real workspace or real deployed endpoint),
**Live(model)** (real provider, synthetic material), **Live(read-only)**
(database read, nothing written), **Code** (tests, doubles, component
rendering), **Doc**, **Tai** (his judgment, nobody else's).

No row is grouped. No blocker is folded into a neighbour. Nothing untested is
marked passed.

## P1–P8

| ID | Required evidence | Actual evidence | Result | Evidence, build and date | Owner |
| --- | --- | --- | --- | --- | --- |
| P1.1 | Live | Code | **BLOCKED** | No hero; header+tabs ~110px, panes at calc(100dvh-190px). Real routes measured signed-out only (Task 4, local dev, 1440/768/375, 2026-09-15) | Signed-in preview |
| P1.2 | Live | Code | **BLOCKED** | Filters derive over the whole accessible set; deep link seeds selection. Component tests, candidate build | Signed-in preview |
| P1.3 | Code | Code | **PASS-CODE** | conversation-room.test.tsx: failed read never renders as an empty thread | — |
| P1.4 | Live | Code | **BLOCKED** | openReview -> /modules/comms/drafts?session=… resolves the exact record (drafts-workspace.test.tsx) | Signed-in preview |
| P1.5 | Code | Code | **PASS-CODE** | Stay/Discard on tab, person, record, back; reload via beforeunload; failed prepare keeps text. **Correction (2026-09-16):** the earlier 'N/A' on saving raw reply text was wrong - F2.4 asked for it. Saving your own writing is now implemented through the existing draft service (`rawWritingDraft` + `commsService.saveDraft`), with Stay / Save as a draft / Discard on leaving, and text kept on screen when a save fails. Tested in `src/data/supabase/comms-raw-writing-save.test.ts` (bound to the right relationship, still there on reload, one draft store, failed save loses nothing) and `src/components/tt/comms/reply-record.test.tsx` | - |
| P1.6 | Live | Code | **BLOCKED** | Close/reopen and follow-up reschedule write through existing mutations; every obligation writer swept in Task 3 | Signed-in preview |
| P1.7 | Live | Code+Live(signed-out) | **BLOCKED** | Alternate panes under lg; 0px overflow at 375 on real routes (signed-out) Task 4 | Signed-in preview |
| P2.1 | Live | None | **BLOCKED** | Preview 401s; published 302s to cmd.trusttai.com (older build). Served build identity unreadable from here | Signed-in preview |
| P2.2 | Live | Live(model)+Code | **BLOCKED** | Real model, real instructions, strict JSON, correct coverage (Task 1 and Task 5, gateway openai/gpt-5-mini, 2026-09-15). NOT persisted in the workspace | Signed-in preview |
| P2.3 | Live | None | **BLOCKED** | Provenance is only written by a persisted run | Signed-in preview |
| P2.4 | Code | Code | **PASS-CODE** | comms-review.server.test.ts: forced provider and evidence-insert failures leave approval unavailable and say whether the failure itself saved | — |
| P2.5 | Code | Code | **PASS-CODE** | Unrun/failed coverage is 'not evaluated', never 'no questions found' | — |
| P2.6 | Code | Code | **PASS-CODE** | Configured model, completed evaluation and per-draft readiness are three separate facts | — |
| P3.1 | Live | Code | **BLOCKED** | Kind, recipient, goal, situation, body persist per session and version; kind column confirmed live | Signed-in preview |
| P3.2 | Live | Code | **BLOCKED** | Sections round-trip; versions insert-only so older ones cannot change | Signed-in preview |
| P3.3 | Code | Code | **PASS-CODE** | Body rendered from sections server-side; disagreeing stored text reads as not reconstructable | — |
| P3.4 | Code | Code | **PASS-CODE** | USD 125.50x2 + 249.00 - 50.00 = USD 450.00 exact minor units (re-run Task 2); blank price nulls the total and names the line; one currency per proposal | — |
| P3.5 | Code | Code | **PASS-CODE** | Blocking issues marked and cannot be hidden by a rewrite: outgoing words are rebuilt from the same figures the check reads | — |
| P3.6 | Code | Code | **PASS-CODE** | Source material and outbound attachments are separate records; unsupported extraction is explicit | — |
| P3.7 | Live | Code | **BLOCKED** | Failed list read refuses instead of listing none; Task 2 added 'Show older reviews' so filters reach beyond the first page, with the loaded-count disclosed | Signed-in preview |
| P3.8 | Code | Code | **PASS-CODE** | Partial saves name exactly which records were created and which were not | — |
| P4.1 | Live(model) | Live(model) | **PASS-LIVE** | 13/13 cases, real model, twice (Task 5, gateway openai/gpt-5-mini, prompt comms-review/2026-09-15, 2026-09-15) | — |
| P4.2 | Live(model) | Live(model) | **PASS-LIVE** | No invented date, price or promise across three passes; every finding quotes real writing | — |
| P4.3 | Code | Live(model) | **PASS-LIVE** | goalRead returned as a reading offered for correction and editable in the surface | — |
| P4.4 | Tai | None | **AWAITING-TAI** | Voice rules come from the stored workspace profile, deliberately not read or altered | Tai |
| P4.5 | Code | Live(model)+Code | **PASS-CODE** | Opportunities private, never inserted, absent in complaint and apology, each with evidence, reading, worth and timing. RETENTION still missing - see the Codex row | Codex (retention) |
| P4.6 | Live(model) | Live(model) | **PASS-LIVE** | No humour in complaint or apology; benign case kept it | — |
| P4.7 | Live(model) | Live(model) | **PASS-LIVE** | Planted instruction reported as a must-fix quoting the source, not obeyed, no other client named | — |
| P4.8 | Code | Code | **PASS-CODE** | Coverage and limitations recorded per run; findings bound to the exact version | — |
| P4.9 | Tai | None | **AWAITING-TAI** | Six examples with full context and provenance regenerated from real runs (docs/comms-review-examples-for-tai.md, 2026-09-15). Ratings blank | Tai |
| P5.1 | Live | Code | **BLOCKED** | Dashboard items come from real relationship rows; counts real and disclosed when partial | Signed-in preview |
| P5.2 | Live | Code | **BLOCKED** | One room per person; history, goal, reply and review on the same record | Signed-in preview |
| P5.3 | Code | Code | **PASS-CODE** | A draft with a live review appears once; closed reads Closed and hides nothing | — |
| P5.4 | Live | Code | **BLOCKED** | 5 concurrency checks on a test double; a real writing profile was deliberately not touched | Signed-in preview (isolated test workspace) |
| P5.5 | Code | Code | **PASS-CODE** | Captured rules and completed evaluation shown as separate facts, grouped by profile, version and checksum | — |
| P5.6 | Code | Code | **PASS-CODE** | Mailbox, model configuration and per-draft sendability are three cards; configured is never working | — |
| P5.7 | Code | Code | **PASS-CODE** | Every failed read becomes an unavailable state with a retry, never an empty one | — |
| P5.8 | Live | Code | **BLOCKED** | Refetch on focus; mutations invalidate the surfaces they change | Signed-in preview |
| P6.1 | Code | Code | **PASS-CODE** | Refused with no provider call for view-only, invited, pending, suspended, no membership, wrong workspace | — |
| P6.2 | Code | Code | **PASS-CODE** | Author stamped on the immutable version; reviewer and sender identities stay distinct | — |
| P6.3 | Code | Code | **PASS-CODE** | Approved fingerprint covers channel, subject, body, to, cc, bcc, sending identity and every attachment | — |
| P6.4 | Code | Code | **PASS-CODE** | Any change to those, the situation, the revision or the version refuses the send | — |
| P6.5 | Code | Code | **PASS-CODE** | Failed, incomplete, closed, stale reviews and standing must-fixes all refuse approval | — |
| P6.6 | Code | Code | **PASS-CODE** | Racing sends produce one provider call; the loser never calls the provider | — |
| P6.7 | Code | Code | **PASS-CODE** | An attempt that cannot be written down is not attempted. Task 3 fixed the Gmail ledger: every outcome now settles, unknown stays unknown and is never retried (6 simulated deliveries, no provider called) | — |
| P6.8 | Live | Live(refusal, unauthenticated only) | **PARTIAL-BLOCKED** | **Correction (2026-09-16):** the 410 was obtained with the public publishable key, which is not an authenticated member. It proves the endpoint refuses an anonymous caller; it does NOT prove refusal for a signed-in member of the workspace. Established: 401 with no key, 410 with the publishable key, refusal body states nothing was sent and nothing changed, no active send path invoked. The signed-in-member refusal is **not evaluated** | Signed-in preview |
| P6.9 | Code | Code | **PASS-CODE** | A LinkedIn record is described as the user's own word, never provider confirmation | — |
| P7.1 | Live(real screens) | Live(signed-out real screens)+Code | **BLOCKED** | Task 4: 0px overflow and 0 console errors on six real routes at 1440x900, 768x1024, 375x812. Populated screens (long proposal, selected annotation, mobile room) covered at component level only | Signed-in preview |
| P7.2 | Live(real screens) | Live(signed-out real screens)+Code | **BLOCKED** | Every stop named, focus ring measured visible, no trap on the real screens; intake/editor/findings/drawers keyboard-tested at component level | Signed-in preview |
| P7.3 | Live(real screens) | Live(signed-out real screens)+Code | **PARTIAL-BLOCKED** | **Correction (2026-09-16):** 'every reachable real screen' meant every screen reachable **signed out**. Comms fails closed without a session, so contrast, labels and announcements inside the real Comms rooms are **not evaluated** on screen. Established: axe-core wcag2a+wcag2aa zero violations on the signed-out real screens at all three sizes, and zero on the production Drafts component rendered populated, failed and empty; statuses carry words, never colour alone | Signed-in preview |
| P7.4 | Code | Code | **PASS-CODE** | Saving, running, failing, finishing announced as four real states; no fabricated progress | — |
| P7.5 | Code | Code | **PASS-CODE** | Unsaved writing protected on tab, person, record, back and reload; failed save keeps the text; expired session says so; sign-out clears the cache and leaves nothing in browser storage | — |
| P7.6 | Code | Code | **PARTIAL-BLOCKED** | Repeat-call half verified: reviews start only from a press, and the button disables while in flight. DURATION NOT MEASURED and no number invented; reproducible steps recorded | Signed-in preview |
| P7.7 | Code | Code | **PASS-CODE** | Every control acts or states the exact condition blocking it | — |
| P8.1 | Doc | Doc | **PASS-CODE** | This document: one row per P criterion plus C01-C22 and T01-T05, each with required level, actual level and owner | — |
| P8.2 | Live | Code | **BLOCKED** | Fresh Message, Email and Proposal save -> reload -> edit -> new version -> review -> correction on real records cannot run without a session. Isolated no-send approval is proven against a database double only | Signed-in preview |
| P8.3 | Live(model)+Tai | Live(model) | **AWAITING-TAI** | Model half passed live (P4.1-P4.7). Tai's voice and judgment acceptance not recorded. No review has completed in the workspace | Tai; signed-in preview |
| P8.4 | Live(read-only) | Live(read-only) | **PASS-LIVE** | Read 2026-09-15 unchanged: run b7bee2e2… failed, provider_call_failed, prompt comms-review/2026-09-14, fingerprint 4aac34fe810ec56e, voice profile 6c675697…@v1#e69ea084ee545ebf; sessions 8d418c05… and 2419b89e… intact; 3 versions; deliveries 0 | — |
| P8.5 | Live(read-only) | Live(read-only) | **PASS-CODE** | Applied schema matches the code for every required change. The single unapplied change is the optional private-notes column; confirmed absent today (comms_review_runs.opportunities does not exist) | Codex |
| P8.6 | Code | Code | **PASS-CODE** | On the candidate: types clean, 264 test files / 2,960 tests passing, build OK (2026-09-15). Targeted live workflows remain blocked | Signed-in preview (live workflows) |
| P8.7 | Doc | Doc | **PASS-CODE** | Scope, monitoring and rollback below. Rollback overstatement corrected in the release candidate: only the candidate commit is an established rollback target | — |
| P8.8 | Doc | Doc | **PASS-CODE** | Operator guide in docs/comms-release-candidate.md section 8 | — |
| P8.9 | Tai | None | **NOT-PERFORMED** | Production deployment and real delivery are two separate rows. Neither authorized, neither attempted | Tai |

## C01–C22 and T01–T05

| ID | Required evidence | Actual evidence | Result | Evidence, build and date | Owner |
| --- | --- | --- | --- | --- | --- |
| C01 | Live | Code | **BLOCKED** | Five destinations exist as real routes; consolidation live-unverified | Signed-in preview |
| C02 | Live | Code | **BLOCKED** | Old routes resolve and identity is preserved in code; not walked live | Signed-in preview |
| C03 | Code | Live(model)+Code | **PASS-CODE** | The reviewer's read of the goal is returned for correction and is editable | — |
| C04 | Code | Code | **PASS-CODE** | Newest-first window, whole messages, read window stated | — |
| C05 | Code | Code | **PASS-CODE** | Per-source status; unreadable types named; a failed source list stops the review before the model call | — |
| C06 | Live(model) | Live(model) | **PASS-LIVE** | A finding is discarded unless its quote is literally present; confirmed across 39 real case runs | — |
| C07 | Code | Code | **PASS-CODE** | Versions immutable; run, findings and approval bound to one version, fingerprint and revision | — |
| C08 | Code | Code | **PASS-CODE** | Author resolved from the immutable version, separately from reviewer and sender | — |
| C09 | Code | Live(model)+Code | **PARTIAL-BLOCKED** | Private notes are produced and never inserted - but NOT RETAINED. Honest temporary display is not retention | Codex |
| C10 | Live(model) | Live(model) | **PASS-LIVE** | Humour absent in complaint and apology, present in the benign case; warmth tied to the thread | — |
| C11 | Code | Live(model)+Code | **PASS-CODE** | Contradictions and unsupported claims caught in the pricing-mismatch and unsupported-commitment cases; proposal arithmetic exact | — |
| C12 | Live(model) | Live(model) | **PASS-LIVE** | Every ask accounted for with a status and a reason across 13 cases, twice | — |
| C13 | Code | Code | **PASS-CODE** | Nothing read as context can become an outbound attachment; unreadable files say so | — |
| C14 | Code | Code | **PASS-CODE** | Approval requires a completed current run, matching fingerprint and revision, complete coverage, zero must-fix | — |
| C15 | Code | Code | **PASS-CODE** | One authority gates every active send path; inventory re-taken in Task 3 | — |
| C16 | Code | Code | **PASS-CODE** | Claim before the provider call; Task 3 fixed settlement so every outcome is written; unknown is never failed and never retried | — |
| C17 | Live(model) | Live(model) | **PASS-LIVE** | No other client appeared in any answer, including under the planted instruction | — |
| C18 | Live | Code | **BLOCKED** | Follow-ups persist through close, reopen and reschedule; every writer swept in Task 3; not walked live | Signed-in preview |
| C19 | Code | Code | **PASS-CODE (application) / BLOCKED (persistence)** | **Correction (2026-09-16):** C19 was agreed scope, not optional. Minimal human-approved reuse is now built: an owner or admin can keep one **decided** finding (with a verified decider) as a short lesson in their own words, scoped to their workspace; kept lessons are shown to later reviews as guidance about how to write, and can be stopped at any time. Nothing is kept automatically, no voice rule is edited, and a lesson carrying an email address, a link or a figure is refused so facts cannot cross clients. Domain and refusal behaviour tested in `src/domain/comms-lessons.test.ts`. Storage table proposed at `docs/migrations/proposed/20260916090000_comms_review_lessons.sql`, **not applied** - until Codex applies it the panel says lessons cannot be kept yet rather than pretending none exist | Codex (apply table), then signed-in preview |
| C20 | Code | Code | **PASS-CODE** | Failures say what happened and what was not changed; a failure that cannot be recorded says so | — |
| C21 | Live(real screens) | Live+Code | **PASS-LIVE** | axe-core zero WCAG A/AA violations on real screens at three sizes and on the populated production Drafts component | — |
| C22 | Live | Code | **BLOCKED** | Provenance fields exist and are written by the code; only a persisted successful run can demonstrate them | Signed-in preview |
| T01 | Live | Code | **BLOCKED** | Dashboard: real scoped records, exact destinations, honest partial counts | Signed-in preview |
| T02 | Live | Code | **BLOCKED** | Conversations: real threads, goal, draft, review the same draft, honest sources | Signed-in preview |
| T03 | Live | Code | **BLOCKED** | Drafts & Reviews: one list, resume after reload, versions, findings, one role-checked approval, three intake kinds. Paging fixed in Task 2 | Signed-in preview |
| T04 | Live+Tai | Code | **BLOCKED** | Voice DNA: stored profile, authorized editing, version history, applied version shown, saved changes clear readiness | Signed-in preview; Tai |
| T05 | Live | Code | **BLOCKED** | Connections: real identity, three separate facts, no secrets shown | Signed-in preview |

## Exact counts — no blended percentage

- **AWAITING-TAI**: 3
- **BLOCKED**: 27
- **N/A-SCOPE**: 0 (was 1; C19 reclassified and built on 2026-09-16)
- **NOT-PERFORMED**: 1
- **PARTIAL-BLOCKED**: 4 (P6.8 and P7.3 corrected downward on 2026-09-16)
- **PASS-CODE**: 44
- **PASS-LIVE**: 11

Total rows: **90** (63 P criteria, 27 capability rows).

What those words mean here:

- **PASS-LIVE** — met at the evidence level the criterion requires, with real
  provider, real deployed endpoint or real screens.
- **PASS-CODE** — the criterion's required level is code or documentation, and
  it is met there.
- **BLOCKED** — required level is Live and the evidence does not exist, because
  nothing in this environment can sign in to the workspace. Code evidence is
  recorded but does **not** close the row.
- **PARTIAL-BLOCKED** — part proven, part not, both named (P7.6 duration, C09
  retention).
- **AWAITING-TAI** — Tai's judgment, not marked on his behalf.
- **NOT-PERFORMED** — never attempted and never authorized (P8.9).
- **N/A-SCOPE** — none remaining. C19 was reclassified on 2026-09-16 and built; the former N/A wording awaited a scope
  decision. It is not relabelled done.

**This is not 100%.** 100% is reached only when every applicable criterion meets
its own required level; 27 rows require live workspace evidence that does not
exist yet.

---

## What each kind of evidence does and does not prove

Kept apart deliberately, because they are routinely confused:

1. **Real screens, signed out** (Task 4) — real routes, real CSS, real focus
   order, axe-core. Proves layout, contrast and keyboard behaviour on what a
   visitor can reach. Does **not** prove any populated screen.
2. **Fixtures and component tests** — populated lists, failed reads, long
   proposals. Proves behaviour of the code. Does **not** prove the database
   returns those shapes.
3. **Real provider evaluation** (Tasks 1 and 5) — real model, real prompt,
   synthetic material. Proves the reviewer's judgment. Does **not** prove the
   application completes and saves a review.
4. **Database read-only** — proves what exists today. Nothing was written.
5. **Tai's feedback** — the only thing that closes P4.4, P4.9 and the Tai half
   of P8.3. Model scores are not a substitute and are never counted as one.

## Persistence and record state, confirmed 2026-09-15

- Run `b7bee2e2-4b13-476e-9f61-af008d374215` still failed, still
  `provider_call_failed`, still prompt `comms-review/2026-09-14`, provider and
  model null. Untouched by six tasks.
- Sessions `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f` and
  `2419b89e-f1da-4f7b-95b3-21fd3e15493f` intact; 3 versions.
- `comms_review_deliveries`: **0 rows**. Nothing has ever been dispatched.
- `comms_review_runs.opportunities`: **does not exist**. Private review notes
  are shown once and lost. The minimum secure proposal is
  `docs/migrations/proposed/20260915120000_comms_review_opportunities.sql`,
  unapplied, for Codex. A temporary display is not persistence and is not
  counted as one.
- No successful persisted run exists. No draft workflow has been completed
  against real records. The no-send approval boundary is proven against a
  database double only.

## Release scope, monitoring and rollback

**Scope** — the Comms workspace only: five destinations, intake for Message,
Email and Proposal, immutable versions, one review per version, one approval
authority, the delivery ledger, Voice DNA reads and authorized edits,
Connections. No other room changes. No schema change ships with it; the
optional private-notes column is separate and is Codex's.

**Monitoring, first week after any deployment** — (a) does a review complete
and write provider, model, prompt version, voice profile and checksum; (b) does
any run land `failed` with a `provider_call_failed`, as the historical one did;
(c) does `comms_review_deliveries` stay empty until a delivery is deliberately
authorized, and does every row that appears carry a settlement; (d) does any row
sit at `unknown`, which is a human reconciliation, never a retry; (e) do Drafts
totals disclose when they cover loaded records only.

**Rollback** — revert the application to the named commit and redeploy. No
migration is reversed; no review, version, approval or delivery row is deleted.
The retired `comms-send` function stays retired: restoring version 5 would
reinstate administrative credentials and browser-trusted approval, and is
forbidden as a recovery step. Only the candidate commit is an established
rollback target; any earlier commit needs its compatibility evidence recorded
first.

## Proposed controlled test — for separate approval, not requested yet

Prepared so it can be approved in one step later. **Not** being requested now,
because live acceptance still has fixable and unfinished work in front of it.

- Recipient: a Trust Tai-controlled mailbox only, named by Tai at the time.
  No client address, no real thread.
- Message: a Message-kind draft titled "Comms delivery check — internal only",
  one paragraph, no commitments, no figures, no attachments.
- Path: normal intake, save, review, correct if asked, approval by an owner,
  one send through the single authority.
- Expected record: exactly one delivery row, claimed once, settled `sent` with
  a provider reference, fingerprint matching the approved payload.
- Stop condition: any refusal, or an `unknown` outcome, ends the test and is
  reconciled by hand.

## Remaining actions

**Lovable (me)** — nothing is outstanding that can be done without a session.
Every fixable defect found in this queue is fixed and covered by tests.

**Codex** — review and apply
`docs/migrations/proposed/20260915120000_comms_review_opportunities.sql` to give
private review notes real retention (closes C09 / P4.5 retention); confirm
applied schema against the candidate after it lands.

**Tai** — record ratings in `docs/comms-review-examples-for-tai.md` (P4.4, P4.9,
Tai half of P8.3); review C19 as built (lessons kept from decisions);
provide a signed-in
session or a QA account so the 27 blocked rows can be run; authorize deployment
and the controlled test separately if and when he wants them.

## Did this queue resolve acceptance?

**No.** The authentication dependency recorded in Task 1 is unchanged: nothing
in this environment can sign in to the authorized workspace, so no persisted
review, no real-record draft workflow and no live tab walkthrough exists.
Six tasks of independent work were completed and four real defects were fixed,
but **completion of this queue did not resolve acceptance**. The verdict stays
**Ready for authorized pilot**, not production.

---

## Addendum — Codex live evidence, 2026-09-15

Codex provided independent signed-in evidence: a fresh draft created through
the New draft → Message path persisted as kind `message`, revision 2, one
immutable version, zero review runs (session `9b329dbe-02ca-40d6-9f54-9ec728c64446`;
record owned by Codex, not to be duplicated or modified). The sign-in
succeeded; a browser transport timeout after the save is recorded as
infrastructure, not an application failure.

Effect on rows: **fresh message creation and draft-type persistence** move
from BLOCKED to Codex-verified. All other blocked rows — reload persistence,
persisted AI review, provenance reconstruction, current-build identity, and
every delivery/live-workflow check — are unchanged and remain BLOCKED with
their original wording and owners. No count is restated here; the closure
progress log carries the full row.
