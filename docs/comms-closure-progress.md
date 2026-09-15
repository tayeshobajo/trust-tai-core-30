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
