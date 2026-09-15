# Comms release readiness — a decision document for Tai

Date: 2026-09-14. Nothing in this document has been published, and no message
has been sent to a client.

## The short version

**The AI review has never succeeded in production, and it cannot be diagnosed
from here.** Every screen, gate and record described below is built and tested
in code, but code tests are not live evidence. The single live attempt failed
without recording why. The reviewed code now records why — but only once it is
running in production.

So the decision in front of you is not "is the feature ready". It is: **deploy
the reviewed code so the next failure explains itself, or leave production as
it is and accept that the cause stays unknown.**

## Commit versus what is running

| | |
| --- | --- |
| Reviewed working commit | `0f0b92f9787cbedd14dc1bef8c08719492f738a0` |
| Hosted build | behind this commit — the live run wrote the old 16-hex voice checksum, while this code writes SHA-256 |
| Evidence of the gap | run `b7bee2e2-4b13-476e-9f61-af008d374215`, checksum `e69ea084ee545ebf` |

## What deploying would and would not change

Safe to deploy, in the sense that it adds no new way to send:

- Sanitized provider diagnostics: provider, model, HTTP status, error category
  and error name recorded on a failed run. Never a key, never a prompt.
- "Not evaluated" instead of "no questions found" on a failed or unrun review.
- The five-tab Comms workspace, single-pane Drafts & Reviews, honest counts,
  overdue follow-ups, proposal structure, Voice DNA history, and the Connections
  split into account health / model availability / per-draft readiness.
- Reads of the two applied columns (`kind`, `structured_source`).

**Correction — the app can send.** An earlier version of this document said a
deploy "cannot send anything" because the legacy `comms-send` edge function is a
refusal (v6, POST 410). That is true of the legacy function only. The app's own
governed route, `/api/public/comms/send`, is separate and **does** dispatch when
a draft carries a valid current approval; the drafts surface calls it. So the
real statement is narrower:

- Deploying adds **no new send path** and changes **no** approval authority,
  membership check, RLS policy, immutable version, or existing record.
- Sending still requires a human approval bound to the exact version — which in
  turn requires a completed review run, and none has ever completed here.
- "No client send during QA" is therefore a **restraint in the test procedure**,
  followed by the person running it — not a property of the deployed app.

Deploying does **not** change:

- Provider or model configuration. `openai/gpt-5-mini` is what is *configured*;
  with zero completed runs it is not *verified*, and must not be described as
  working.
- The legacy `comms-send` refusal (v6).

## A bounded alternative to publishing the suite

The choice is not "publish everything" versus "never learn the cause". The
diagnostics are self-contained, and the smaller path is:

1. Deploy to the **preview** build (`project--<id>-dev.lovable.app`) rather than
   production, sign in there, and run the review once.
2. The exact scope to review before either deploy is the diff of the reviewed
   commit against the hosted build — the manifest below.
3. No deployment was made this turn.

| | |
| --- | --- |
| Reviewed commit | `0f0b92f9787cbedd14dc1bef8c08719492f738a0` and later |
| Diagnostics surface | `src/domain/comms-provider-diagnostics.ts`, `src/lib/comms-review.server.ts` |
| Wording fix | `src/components/tt/comms/review-workspace.tsx` |
| Send behaviour | unchanged: `src/routes/api/public/comms.send.ts`, `supabase/functions/comms-send` |


## The provider failure, stated honestly

- One live run, `b7bee2e2-4b13-476e-9f61-af008d374215`, failed with
  `provider_call_failed`. Provider and model were null.
- The Lovable gateway shows zero requests over seven days, and an OpenAI key is
  configured — consistent with direct routing, but that is an inference, not a
  finding.
- No status code, no error body, no category was captured, because the running
  build did not capture any. **The cause is unknown and is not asserted.**
- It reproduces in tests only as a shape (a refusal with no status), not as a
  cause.

## Signed-in QA, after a deploy

Run against the QA workspace. Do not overwrite session
`8d418c05-55b8-4dd9-8e83-1d0defbb7a8f`.

1. **Proposal save and reopen.** New draft → Proposal. Fill scope, two
   deliverables, two priced lines, one assumption, one next step. Save. Reload
   the page. Expect: the same record, the same kind, the composer rehydrated
   with the same sections and the same total. If the screen says the kind or
   structure was not recorded, the hosted build is older than the applied
   columns.
2. **Voice provenance.** Voice DNA → save a small edit. Expect the version to
   increase, and any open readiness to re-ask rather than stay green. Then open
   a review and confirm the run records the new version and a SHA-256 checksum
   (64 hex), not a 16-hex one.
3. **Review.** Open the QA draft, ask for a review. Expect either a completed
   run, or a failure that now names provider, model, status and category. Copy
   the failure verbatim; that is the diagnosis this deploy exists to obtain.
4. **Connections.** Expect the reviewing-model card to state whether a model is
   configured and whether any run has ever completed. Both statements must match
   step 3.

## What is not ready

- The AI review is not functional and must not be described as functional.
- T02 Conversations is unaudited.
- No live verification of anything in this slice exists from this environment.
