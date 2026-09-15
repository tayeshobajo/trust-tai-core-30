# Comms acceptance closure

Evidence labels: **Implemented**, **Code-tested**, **Live-verified**,
**Tai-accepted**, **Codex-verified**, **Blocked**, **Not applicable (reason)**.
Code or fixture evidence never closes a required live check. Nothing here is
marked accepted or verified on Tai's or Codex's behalf.

## The one environment blocker (recorded once)

**Missing dependency: an authenticated browser session against the external
Supabase project `okydosoacqdnursmmenf` in this execution environment.**

- The Lovable preview host `https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app/`
  answers **HTTP 401** to an unauthenticated request (checked 2026-09-15 16:43 UTC,
  `cf-ray a3b916a578cef18c`). No HTML or asset fingerprint is served, so the
  preview's build identity cannot be read from outside a session either.
- The sandbox reports `LOVABLE_BROWSER_AUTH_STATUS=no_supabase`: this project's
  backend is external and unmanaged, so no session can be injected or minted here.
- Authentication must not be bypassed, and the service role must never be used
  to manufacture signed-in-user evidence. Both are refused, not worked around.

Every criterion below that needs a signed-in workspace therefore stays
**Blocked**, with a reproducible check prepared so it can be executed in one
pass by whoever holds a session.

## Task 1 — Current preview and persisted AI review (P2.1–P2.6, P8.4)

Environment: Lovable sandbox, 2026-09-15, local HEAD
`863cafbcc0e9a4771c0aeb2e27633724ffdd15c7` (working tree contains no code
change from this task). External Supabase `okydosoacqdnursmmenf`. No publish,
no send, no schema applied, no QA record created or altered.

| ID   | Evidence type                             | Build / environment                                                                   | Records                                                                            | Result                                                                                                                                                                                                                                                                                                                                                                                               | Remaining owner                            |
| ---- | ----------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| F1.1 | Live HTTP probe (unauthenticated) only    | Preview host above; published host redirects to `https://cmd.trusttai.com/` (HTTP 200) | none                                                                                | **Blocked.** Preview returns 401 without a session, so neither the served build identity nor its relation to local HEAD can be established, and no authorized workspace could be entered. The published host serves an older build whose contents cannot be attributed to this commit without publishing, which is forbidden here.                                                                    | Holder of a signed-in preview on this build |
| F1.2 | **Blocked** for the app path; provider path **Live-verified** | Real review prompt and real transport, executed server-side in the sandbox              | No workspace record created. Probe run only, not persisted.                          | **Blocked** as an application acceptance: no fresh QA session, version or run could be created, because creating one requires a signed-in session. The reasoning half was proven live against the real `REVIEW_INSTRUCTIONS` and the real provider transport with the exact scenario (source asks day + guide; facts Tuesday and Tai; draft answers only Tuesday): the reply carried **both obligations** (`answered` for the day, `missing` for the guide) and a **must_fix omission finding** naming the unanswered question. Source locations and persistence are the untested half. | Holder of a signed-in preview on this build |
| F1.3 | Provider path **Live-verified**; persistence **Blocked**      | Same                                                                                    | Probe runs only                                                                      | **Partly closed.** The corrected draft ("…Tuesday, and Tai will be your guide on the day.") was re-run through the same path: the missing obligation became `answered`, the must_fix omission disappeared, and nothing was fabricated — no invented time, place, price or commitment appeared in either reply. The reload-shows-saved-evidence half is **Blocked**.                                   | Holder of a signed-in preview on this build |
| F1.4 | **Blocked**                                | —                                                                                       | Deliberately not evidenced from the historical failed run `b7bee2e2-4b13-476e-9f61-af008d374215` | **Blocked.** Provider, model, prompt, actual author, voice profile/version, exact rules and SHA-256 can only be compared against a *saved* run, and no new run could be saved. The old failed run's partial provenance is explicitly **not** offered as proof of this row.                                                                                                                             | Holder of a signed-in preview on this build |
| F1.5 | **Live-verified** (provider), **Code-tested** (fail-closed)   | Sandbox, real keys, real endpoints                                                      | none                                                                                 | **Closed for the provider cause; no defect found to fix.** The direct OpenAI key still fails (out of credits — a billing fact, unchanged), and the configured fallback answered for real: **`lovable` / `openai/gpt-5-mini`**, three consecutive successful reviews, valid JSON, no 400. The Round 2 JSON-framing fix is therefore confirmed live at the provider boundary. Fail-closed behaviour on source-read, provider and evidence-write failure remains code-tested only. | Holder of a signed-in preview (for the app-level fail-closed paths) |

### What was actually executed

Three synthetic no-send reviews through `callRoadmapProvider` with the
production `REVIEW_INSTRUCTIONS`, in the sandbox, against the real endpoints:

1. Draft answers only the day → both obligations present, guide `missing`, one
   `must_fix` omission finding quoting the draft.
2. Corrected draft naming Tai → guide obligation satisfied, omission gone.
3. Same, with the source's question worded plainly → all obligations
   `answered`, only a `consider`-level structure note remains.

No workspace row was written; no message was sent; no configuration, provider
or model was changed.

### Reproducible check for whoever has a session

On a preview build carrying this commit, signed in to an active membership:

1. Record the preview URL and the served build identity (the `VITE_BUILD_SHA`
   shown in Settings → Diagnostics), and confirm it is this commit.
2. Comms → New draft → Message. Title it `QA CLOSURE F1 — no send`. Paste the
   source text: *"Two questions: which day is the training day, and who will
   guide it? Our notes say Tuesday, and that Tai would lead."* Body: *"The
   training day is on Tuesday."* Save.
3. Run the review. Expect two obligations, the guide one `missing`, and a
   must_fix omission; check each finding points at real source text.
4. Edit to *"The training day is on Tuesday, and Tai will be your guide on the
   day."* Save, re-run: the missing finding clears.
5. Reload the page and confirm both runs are still there, then read the run's
   provenance (provider, model, author, voice profile/version, rules hash)
   against the draft. Record both run IDs here.

Do not approve, do not send.

## Task 2 — Durable drafts and the proposal workflow (P1.4–P1.5, P3.1–P3.8, P8.2)

Environment: Lovable sandbox, 2026-09-15, base commit
`863cafbcc0e9a4771c0aeb2e27633724ffdd15c7` plus the paging fix described in
F2.5 below. External Supabase `okydosoacqdnursmmenf`. No publish, no send, no
schema applied, no QA record created or altered. Gates after the change:
types clean, 262 files / 2,951 tests passing.

| ID   | Evidence type                                      | Build / environment                          | Records                              | Result                                                                                                                                                                                                                                                                                                                                                                                | Remaining owner                            |
| ---- | -------------------------------------------------- | -------------------------------------------- | ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| F2.1 | **Code-tested**; live half **Blocked**              | Sandbox test suite on the commit above        | none (no workspace record created)   | Save → reload → edit → new immutable version → review → correction → re-run is implemented for all three kinds, and each step is covered by tests over fake records: the version row is never mutated, identity, kind, recipient, goal and context revision carry forward unchanged. Proving it **on real records** needs a signed-in workspace — see the one environment blocker above. | Holder of a signed-in preview on this build |
| F2.2 | **Code-verified by execution** (deterministic, no workspace needed) | Sandbox, real `comms-proposal` module executed | none                                 | **Closed.** Executed the exact figures: USD 125.50 × 2 + 249 − 50 → subtotal 500.00, total **USD 450.00** to the penny (integer minor units, no float rounding). Adding an unpriced line makes subtotal and total **null**, names the line, raises a blocking `unpriced_line`, and the rendered words say "Total: not stated — some lines are still unpriced." A blocking warning cannot be written away, because the outbound words are re-rendered from the same structure the checks read. Mixed currencies are **not applicable by construction**: a proposal carries one currency field, so two currencies cannot coexist in one set of sections. Restoring the sections as an editable structure on reload is code-tested; on real records it is blocked with F2.1. | Holder of a signed-in preview (reload half) |
| F2.3 | **Code-verified**                                    | Sandbox, `comms-sources` module               | none                                 | **Closed at the boundary.** The three roles are separate types, not one bag: review sources are context only and the module states outright that nothing in it ever becomes an outbound attachment; the imported draft is the version body; outbound attachments are a different path. Extraction is honest per source — `parsed` only when text was actually recovered, otherwise `unsupported`, `unreadable` or `empty`, each with its own sentence, and coverage is never claimed over a source that was not read. | — |
| F2.4 | **Code-verified**                                    | Sandbox                                       | none                                 | **Closed.** Saving raw writing does not require the AI: creating a draft writes the session and the first version, and running the review is a separate action that can be skipped entirely. There is no second draft store — the workspace writes only to the canonical session/version tables, and nothing is kept in browser storage. Unsaved writing is guarded on every exit (tab, back button, link, row change) by a Stay/Leave prompt, and a failed save leaves the typed text in place rather than clearing the editor. No criterion here is marked N/A for being unbuilt. | — |
| F2.5 | **Defect found and fixed**, now **Code-tested**      | Sandbox, change made in this task              | none                                 | **Was failing.** Direct links already worked (a record is fetched by name, not found in the page). Filters did **not**: the list read only the newest fifty reviews, so a filter could not reach anything older, and the disclosure admitted it instead of fixing it. Fixed: the review list now pages (`offset`, with `hasMore` and the exact total), the list loads older pages on request and keeps them, and the disclosure now reads "Showing N of M reviews … the filter counts only what is loaded". Without a count from the database a full page is still treated as "there may be more", never as everything. Partial saves keep their existing honest reporting (`kindPersisted`, `structurePersisted`), and a retry re-uses the same session rather than creating a second one. | Holder of a signed-in preview (live confirmation) |
| F2.6 | **Code-tested**; live half **Blocked**               | Sandbox test suite                            | none                                 | Leaving a review and returning reopens exactly one bound review — a draft with a live review resolves to that review and the address is corrected so a reload agrees, and two open reviews claiming one draft block sending rather than picking one. Older versions are never rewritten. **Actual persistence evidence on real records is blocked** with F2.1.                     | Holder of a signed-in preview on this build |

### Audit: private opportunity retention (C09 / C13 / P4.5)

Honest temporary display is what exists today, and it is **not** retention.

- The reviewer returns private notes about possible future work. The run tries
  to write them, and when the column is absent it records
  `opportunitiesStored: false` and says so rather than pretending none were
  raised. That is honest, and it still means the notes are shown once and lost
  on reload.
- Therefore **C09/C13/P4.5 are not closed by the current build.** Labelled
  **Blocked on pending SQL**, owner Codex.

**Exact pending SQL** (already written, reviewed for scope, *not applied*):
`docs/migrations/proposed/20260915120000_comms_review_opportunities.sql`.

Minimum secure proposal — one additive column, nothing else:

```sql
ALTER TABLE public.comms_review_runs
  ADD COLUMN IF NOT EXISTS opportunities jsonb NOT NULL DEFAULT '[]'::jsonb;
```

- No new grants, policies, tables or data. The column inherits the run row's
  existing RLS, so it is readable exactly by whoever may already read the run.
- Application behaviour on the column existing: the notes persist and reload,
  and each one's `evidence` is checked in code to be quoted from the source
  material before the row is written.
- Application behaviour on the column still missing: unchanged — the run
  reports `opportunitiesStored: false`, and the reviewer sees "these notes were
  not kept", never a silent empty list.
- Rollback is dropping the column; no other behaviour depends on it.

Nothing in this task applied SQL, published, sent, or altered a historical QA
record.
