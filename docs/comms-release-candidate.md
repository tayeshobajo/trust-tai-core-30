# Comms release candidate

Prepared 2026-09-15 in the Lovable sandbox. This is a reconciliation of the
eight-round pack, not a new build round. Nothing was published, nothing was
sent, and no schema was applied while writing it.

**Decision: Ready for an authorized pilot, with two named limits.** Not ready
for production deployment, because no AI review has ever completed inside the
workspace and no message has ever been delivered through the new gate. Both
need a signed-in preview on this build; neither is a code defect known to us.

---

## 1. What is being released

| Item                 | Value                                                                                                                      |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Commit               | `0dc6215e8bbcbea4e04c887c3effa7861dd1ad39`                                                                                 |
| Branch               | main line of `tayeshobajo/trust-tai-core-30`                                                                               |
| Preview URL          | `https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app` (Lovable sign-in required; responds 401 until then) |
| Published production | `https://trusttai-os-foundation.lovable.app`                                                                               |
| Custom domain        | `https://cmd.trusttai.com`                                                                                                 |
| Backend              | External Supabase `okydosoacqdnursmmenf`. No Lovable Cloud.                                                                |
| Gates on this commit | 262 test files, 2949 tests passing; types clean; lint clean; build OK                                                      |

**The hosted build is not known from here.** A git diff against the last
commit is not a deployment diff: the deployed baseline was never recorded, so
what production is currently running can only be inferred from an old
checksum. Treat that inference as history, not as fact. Before any deploy,
read the hosted build identity first.

**Deployment scope is the whole suite.** Lovable publishes the project, not a
folder. Everything on this commit ships together, including the non-Comms
files touched during the pack (`content-service.ts`,
`content-request-service.ts`, `projects-service.ts`,
`scout-intro-templates.ts`, `roadmap-intel-service.test.ts`) — inspected and
found to be Prettier reflow only, no behaviour change. The fixture routes
under `/mockups/*` also ship; they read nothing and write nothing.

---

## 2. Migration state, read from the live database

Read-only, with the service key, on 2026-09-15.

| Migration                                                | Applied              | Evidence                                                                                                   |
| -------------------------------------------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------- |
| `20260914150000_comms_review_runs.sql`                   | Yes                  | seven review tables answer                                                                                 |
| `20260914160000_comms_review_hardening.sql`              | Yes                  | member writes revoked, org-scoped SELECT                                                                   |
| `20260914170000_comms_review_delivery_hardened.sql`      | Yes                  | `comms_review_deliveries` with `idempotency_key`, `status`, `settled_at`                                   |
| `20260914220000_comms_review_kind.sql`                   | Yes                  | `comms_review_sessions.kind`, `comms_review_versions.structured_source`                                    |
| Voice provenance columns                                 | Yes                  | `voice_profile_id`, `voice_version`, `voice_snapshot_checksum`, `style_context_snapshot` all return values |
| `proposed/20260915120000_comms_review_opportunities.sql` | **No, and optional** | `comms_review_runs.opportunities` returns 42703                                                            |

The one unapplied change is genuinely optional and is not disguised: without
it the reviewer's private notes are shown for that run and not kept, and the
run says they were not kept rather than showing none. No insecure fallback
depends on it. Every other required change is applied.

The superseded proposals (`proposed/20260914170000_...`,
`proposed/20260914220000_...`) are kept only as history; the applied files in
`docs/migrations/` are authoritative.

---

## 3. Evidence by criterion

Labels: **Implemented** (code exists), **Code-tested** (automated check),
**Live-verified** (run against the real workspace), **Blocked**, **Awaiting
Tai**, **Not performed**.

### The eight rounds

| ID                                                     | State                                                                                                                                                | Owner of what remains                  |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| P1.1–P1.7 Conversations                                | Code-tested; P1.1, P1.2, P1.4, P1.6, P1.7 Blocked live. P1.5's "Save" is not applicable: there is no save for raw reply text, and the dialog says so | signed-in preview                      |
| P2.1 Preview identity                                  | Partly Live-verified (Codex signed in, real data seen); exact build behind that session unrecorded                                                   | Codex                                  |
| P2.2, P2.3 A real review completing and its provenance | **Blocked.** The request-format defect is fixed and proven against the real model outside the workspace; no run has been saved inside it             | signed-in preview on this build        |
| P2.4–P2.6                                              | Code-tested                                                                                                                                          | —                                      |
| P3.1, P3.2, P3.6, P3.8 save and reload                 | **Blocked live**; code-tested                                                                                                                        | signed-in preview                      |
| P3.3–P3.5, P3.7                                        | Code-tested, including 125.50 × 2 + 249.00 − 50.00 = USD 450.00                                                                                      | —                                      |
| P4.1–P4.3, P4.5–P4.8                                   | Code-tested on the fixed 13-case set, two consecutive full passes                                                                                    | —                                      |
| P4.4, P4.9 voice and ratings                           | **Awaiting Tai** — six examples in `docs/comms-review-examples-for-tai.md`                                                                           | Tai                                    |
| P5.1–P5.8 five destinations                            | Code-tested; the live walk-throughs Blocked                                                                                                          | signed-in preview                      |
| P6.1–P6.7, P6.9 approval and delivery                  | Code-tested against a fake provider and database double                                                                                              | —                                      |
| P6.8 retired endpoint                                  | Repository body refuses with 410; the **deployed** 410 has not been invoked                                                                          | Codex, with an authorized invocation   |
| P7.1, P7.2                                             | Live-verified on the fixture workspace at 1440×900, 768×1024, 375×812                                                                                | signed-in preview for the real screens |
| P7.3–P7.5, P7.7                                        | Implemented / Code-tested                                                                                                                            | —                                      |
| P7.6                                                   | Code-tested; no measured review duration exists, and none is invented                                                                                | signed-in preview                      |
| P8.2 fresh Message, Email, Proposal end to end         | **Blocked**                                                                                                                                          | signed-in preview                      |
| P8.9 production deploy, real delivery                  | **Not performed** — see section 7                                                                                                                    | Tai                                    |

No ID was renamed, no failure was removed, and nothing mocked is labelled
live. C01–C22 and T01–T05 keep their original definitions in
`docs/comms-review-progress.md` and `docs/comms-tab-integration.md`; the
per-round detail is in `docs/comms-eight-rounds-progress.md`.

### T01–T05 at a glance

All five are code-complete and live-unverified. None is an empty shell; none
is finished. T04 additionally waits on Tai's voice acceptance, T05 on a
review ever completing here.

---

## 4. Historical QA evidence, confirmed intact

Read on 2026-09-15, unmodified by the pack:

- Session `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f`, two versions.
- Run `b7bee2e2-4b13-476e-9f61-af008d374215`: failed,
  `provider_call_failed`, provider and model null, voice profile
  `6c675697-f484-4d3d-9da5-03a222450505` v1, checksum `e69ea084ee545ebf`.
- Session `2419b89e-f1da-4f7b-95b3-21fd3e15493f` (Codex, Round 2): kind
  `message`, open, revision 2, one version, zero runs.
- `comms_review_deliveries` is empty. Nothing has ever been dispatched.

Failed runs are now reconstructable: sanitized provider diagnostics record
what the provider actually answered, without secrets or source text, and a
failed or unrun review says "not evaluated", never "no questions found".

---

## 5. Known issues

1. **No AI review has ever completed in the workspace.** The cause of the
   original failure was found and fixed (a JSON-only output mode the provider
   refuses unless the word "json" appears in the material), and the fix is
   proven against the real model on synthetic cases. It is not proven inside
   the workspace. Until it is, treat AI review as unverified.
2. **The direct OpenAI key has no credits.** Reviews will run on the gateway
   fallback. That is billing, not the defect above, and the two are recorded
   separately.
3. **Nothing has ever been delivered** through the new gate.
4. **Private notes are not kept** until the optional column is applied.
5. **The deployed retired endpoint's 410 is untested** from here.
6. Interactive accessibility evidence is from the fixture workspace; no
   automated contrast audit ran against signed-in screens.

---

## 6. Rollback

Rollback means reverting the application to a known commit and redeploying.
It does not touch data.

- **Never restore the old `comms-send` edge function.** Version 5 ran with
  administrative credentials, treated a browser-writable field as proof of
  approval, and never checked the caller's workspace. The deployed v6 refuses
  everything. A rollback that reinstates v5 is a security regression, not a
  recovery.
- **Do not reverse the applied migrations.** Reviews, versions, approvals and
  delivery records are user data and evidence. The application tolerates a
  missing optional column; it does not tolerate lost approvals.
- An older application build against the current schema is safe: extra
  columns are ignored by older code.
- If a delivery is ever left Unknown, reconcile it by hand — check the
  recipient's thread and settle the record. Never retry automatically.

---

## 7. What still needs your authorization

Two separate decisions, both yours, neither taken:

**A. Publish this commit.** Scope is the whole suite, as in section 1.
Monitoring afterwards: does a review complete and save its provider, model,
prompt version, voice profile and checksum; does Connections show the
mailbox, the model and per-draft readiness as three separate facts; does
Drafts show real totals rather than a capped page.

**B. One controlled delivery.** Not attempted and not attemptable by
accident. Before asking again I will need from you: the exact recipient, the
exact message, and the workspace it is sent from. It would go out through the
one gate — approved by an owner or admin, bound to the exact version, claimed
once, and settled with a receipt.

Until you say otherwise, both stay Not performed.

---

## 8. Operator guide

**Writing a reply.** Open Conversations, choose the person, read the latest
exchange, set what you are trying to achieve, write the reply, then press
Review this draft. Your words are only a record once you prepare the draft;
until then the workspace will warn you before you leave the page.

**Getting it reviewed.** A review always judges one exact saved version. If
you edit, save first — the Review button will say so. The review reads your
material, lists every question and commitment it found, and marks what must
be fixed. Findings quote your own words; a finding quoting an upload means
something in that upload tried to give instructions, which is reported and
never obeyed.

**Approving.** Approval is a separate act, only for an owner or an admin, and
it covers exactly what was reviewed: those words, that recipient, that
sender, those attachments, that channel. Change any of them and the approval
stops applying — that is the system working.

**Reading the states.** "In review" means a live review; "Closed" means
finished; "Approved" means a current approval on the version shown now.
"Out of date" means something moved after approval. A failed review says so
and approves nothing. If a list says it could not be read, that is not an
empty desk — press Try again.

**Voice rules.** Voice DNA holds your rules. Editing needs owner or admin.
If someone else saved while you were editing, your save is refused and you
are shown their newer version rather than silently overwriting it. Changing
the rules invalidates earlier review evidence, on purpose.

**Connections.** Three separate facts: the mailbox, the reviewing model, and
whether one particular draft may be sent. Configured is never the same as
working, and none of them make a draft sendable on its own.

**An unknown delivery.** If a send ends Unknown, the message may have gone.
Check the recipient's thread, then settle the record by hand. Nothing retries
by itself, and the draft is not reset.

**LinkedIn.** Comms never sends there. Marking it sent records your own word,
and the record says so.
