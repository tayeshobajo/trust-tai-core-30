# Comms release readiness — a decision document for Tai

Date: 2026-09-15. Nothing in this document has been published, and no message
has been sent to a client.

## The short version

The AI review has never succeeded in production. The one live attempt recorded
no reason, because the build that ran it could not record one. The reviewed
code does record it — once that code is running somewhere a person can sign in.

This is **not** a choice between publishing the whole suite and never learning
the cause. A preview already exists and needs no publish:

| | |
| --- | --- |
| Preview (Lovable login required) | https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app |
| Published production | https://trusttai-os-foundation.lovable.app |
| Custom domain | https://cmd.trusttai.com |

The preview serves this project's current build and reads the same external
Supabase project (`okydosoacqdnursmmenf`) through the same publishable key,
the same authentication and the same RLS. Using it changes nothing in
production.

## Pinned scope

| | |
| --- | --- |
| Last commit whose full suite was run | `d9fd490cfea8919614e2cb121ac750f5d6d459c2` |
| Changes on top of it | the T02 Conversations geometry slice: earlier-history toggle in the room, compact Comms header, in-room working goal, saved draft → its bound review, navigation guard on unsent writing |
| Hosted production build | **not directly observed.** The only evidence is historical: live run `b7bee2e2-4b13-476e-9f61-af008d374215` wrote a 16-hex voice checksum where this code writes SHA-256. That shows the hosted build was older *at that moment*; it is not a reading of what is deployed now. |
| Unrelated files in the last merge | `content-service.ts`, `content-request-service.ts`, `projects-service.ts`, `scout-intro-templates.ts`, `roadmap-intel-service.test.ts` — inspected: Prettier reflow only, no behaviour change. Not part of this slice, and nothing further was done to them. |

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

## The bounded path, on the preview

1. Open the preview URL above and sign in there. No publish, no production
   deployment, no change to provider or model configuration, no change to the
   workspace's Voice DNA.
2. Run the review once against a **synthetic QA context only**. Do not touch
   session `8d418c05-55b8-4dd9-8e83-1d0defbb7a8f` or run
   `b7bee2e2-4b13-476e-9f61-af008d374215`, and never approve or send.
3. Copy the failure verbatim: the reviewed code now names provider, model, HTTP
   status and error category on a failed run.

| | |
| --- | --- |
| Diagnostics surface | `src/domain/comms-provider-diagnostics.ts`, `src/lib/comms-review.server.ts` |
| Wording fix | `src/components/tt/comms/review-workspace.tsx` |
| Send behaviour | unchanged; the governed route `src/routes/api/public/comms.send.ts` and the legacy edge refusal are both untouched |

No deployment and no publish was made in this turn.


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
