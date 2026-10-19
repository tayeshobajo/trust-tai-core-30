# Meeting deliverables process — review implementation

## Root cause observed

Fathom sync saved normalized transcripts and provider action hints, but did not run semantic interpretation. The meeting overview's review count came from deterministic candidate extraction. The previous semantic endpoint read candidate windows (three turns before, two after), so discussion without a matching cue could never be reasoned over. Review results lived in a browser query cache, not a durable meeting record. Confirmation was a resetting upsert.

Read-only checks on October 19 found the example Emmanuel meeting had 210 stored segments and zero confirmed commitments, and the Soji meeting had 540 segments and zero confirmed commitments. The screenshot's two linked tasks were contextual business tasks, not extracted confirmed obligations. Segment counts do not establish recording completeness. No client tasks were changed during investigation or tests.

## Implemented process

1. Existing Fathom import retains its source identity and transcript-preservation rules.
2. The overview states whether the transcript is missing, awaiting full review, or has a saved full reading. Regex candidates no longer supply the deliverable review count.
3. An authorized operator can prepare the pending meetings in the currently loaded list, or open one meeting and extract its deliverables. Nothing runs merely because a meeting is opened. The queue runs sequentially, stops visibly on error, and retains each successful reading. Reloading resumes unsaved readings. It is a bounded operator workflow, not a background scheduler or claim of processing all historical meetings.
4. The existing authorized Intelligence Runtime reads every stored transcript turn in ordered chunks, carrying context forward, then reconciles the whole set. It distinguishes agreed future work, decisions, dependencies, ambiguity, and reported completion. It considers existing visible business tasks and commitments before suggesting new work.
5. Every finding requires an exact source quote and segment reference. Unsupported citations or timing fail the reading. Ambiguous or inferred ownership stays unresolved. Conditional phrases such as “through this week unless priorities change” never become an invented Friday deadline. Precise relative-date suggestions are anchored to the recorded meeting date, explicitly marked UTC and review-only. No suggested date is written automatically. Proposed definitions of done are distinguished from agreed criteria.
6. A successful reading persists as an existing `activities` row (`meeting.reasoned`), keyed by meeting ID, process version and SHA-256 of source, date, participants, all turns and action hints. It uses the signed-in caller's existing RLS, not service credentials. Changed transcripts cannot reuse an old reading. A source change during processing fails the save. The existing unique source-event index makes competing saves replay one canonical result.
7. A person reviews, corrects and explicitly confirms an agreed obligation through existing commitments. Decisions, reported completion and ambiguity remain visible but are not automatically created as tasks. Definition of done, dependencies and uncertainties are retained in evidence. Authorship, due words/date and original meeting persist through the existing record.
8. Confirmation rechecks current work, rejects potential duplicates, and replays an existing source-key confirmation without resetting its status. Existing same-task updates, completion, roll-forward and permission-aware links remain in the approved interface. Scores still use confirmed obligations only, with verification separate.

## Boundaries and remaining work

- No schema migration, credential change, RLS change, production publication, real task creation/completion, client message or external ChatGPT submission.
- The ChatGPT conversation called “Meetings” remains unresolved by the parent. This implementation uses the app's existing model runtime; it does not pretend to have sent anything to that conversation.
- No unattended worker has been deployed. A durable scheduler/backfill strategy remains separate from this operator-driven queue. The current overview is bounded to the existing recent meeting window.
- Reading every *stored* turn does not prove that Fathom supplied the entire recording. The interface explicitly reports source completeness as unverified.
- Model quality is not certified by mocked-response tests. A real full-transcript acceptance review in an authorized safe context is still needed before production rollout. No claim is made that the live Emmanuel/Soji deliverables have now been populated.
- Existing-work reads fail closed at 300 commitments or 1,000 business tasks, or when unreadable. Pagination/indexed reconciliation is needed for larger organizations. Semantic duplicate detection is advisory plus a fresh confirmation check; only exact source-key uniqueness is atomic. It is not a database guarantee against differently worded concurrent obligations.
- Existing readings intentionally retain their review context. Confirmation rechecks current work, but a future deliberate re-analysis/version policy is needed for corrections introduced after a saved reading.
- Oversized turns (>24,000 characters), more than 30 chunks, reconciliation >180,000 characters, invalid model output, provider errors, and persistence failure stop processing. No partial output is labelled complete. Long recordings may exceed deployment request duration; background jobs are the appropriate next extension.

## Validation

- Steward suite: 135 tests across 19 files, including every-turn/chunk coverage, reconciliation, exact evidence, grounded dates, inferred owners, reported completion, duplicate identity, failure propagation and transcript-version changes.
- Approved interface suite: 35 tests across 7 files, including sequential queue/resume/failure and confirmation identity/duplicate protections, plus existing completion, links, status and roll-forward checks.
- Disposable local PostgreSQL: 3 integration tests pass for persistent updates/roll-forward, completion compare-and-swap, and saved-reading replay/access denial. No production database fixture writes.
- TypeScript and production build pass. Changed TypeScript files pass ESLint. Existing whole-repository lint baseline remains outside this scope.
- Browser review: isolated fictional review at 1440px and 375px; controls progressively disclosed, confirmed feedback verified without backend writes. Screenshots: `screenshots/deliverables-1440.png`, `screenshots/deliverables-375.png`. Original approved overview/detail screenshots remain available at desktop/tablet/mobile sizes.

Production publication and signed-in safe-context end-to-end acceptance remain pending parent review.

## Independent review corrections

The interpretation POST now resolves existing organization app enablement, member override, role-level access and role ceiling server-side before reading a transcript or calling the model. It rechecks before saving. Viewer and narrowed view-only access are denied; unreadable policy fails closed. This uses existing tables and the same app-access resolver; no policy migration or grant is required.

Fuzzy title overlap now requires a recorded reconciliation explanation rather than permanently prohibiting separate work. The reviewer sees the similar record's title, ID and status, compares client/source/delivery period, and can explicitly explain the distinct obligation. The explanation is retained in evidence. Exact source-key retries still replay the original task unchanged, and the insert retains conflict-ignore semantics. Regressions cover completed and open historical work, separate clients/meetings and retry status preservation.

Updated checks: 138 Steward tests, 37 interface tests, TypeScript and build pass. A build-time `steward-build.json` asset reports Git revision and tracked dirty state for exact hosted-preview verification; absence of Git metadata reports null rather than inventing a revision.

Correction to initial preview handoff: “Build unsuccessful” is retained in a zero-opacity, collapsed DOM container. It was incorrectly treated as a visible error. The actual Lovable developer update is completed; separate hosted asset verification is required to establish served revision.

A saved review can now request an explicit fresh model comparison. The server still reads the canonical stored transcript and checks work access, but bypasses both cache reuse and persistence for that comparison. It cannot confirm tasks in the comparison view. Regression coverage verifies no activities read/write and that a supplied replacement transcript is ignored. The saved reading remains intact. Review provenance and preparation time are visible; reported-completion labels explicitly say unverified. Updated Steward checks: 139 tests.
