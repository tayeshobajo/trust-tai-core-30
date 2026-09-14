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

Safe to deploy, because it cannot send anything:

- Sanitized provider diagnostics: provider, model, HTTP status, error category
  and error name recorded on a failed run. Never a key, never a prompt.
- "Not evaluated" instead of "no questions found" on a failed or unrun review.
- The five-tab Comms workspace, single-pane Drafts & Reviews, honest counts,
  overdue follow-ups, proposal structure, Voice DNA history, and the Connections
  split into account health / model availability / per-draft readiness.
- Reads of the two applied columns (`kind`, `structured_source`), with the code
  still tolerating their absence.

Deploying does **not** change:

- Provider or model configuration (`openai/gpt-5-mini` stands until there is an
  evaluation set).
- The send path. `comms-send` v6 stays a refusal: POST returns 410. No client
  send becomes possible.
- Approval authority, membership checks, RLS, immutable versions, or any
  existing record.

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
