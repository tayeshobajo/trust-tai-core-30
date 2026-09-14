# Comms review: gate assessment and the first functional slice

The prototype at `/mockups/comms-next` is a picture, not a working reviewer. Below is
an honest reading of the 22 outcome gates against code that exists today, then the
one slice to build next.

## How to read the states

- **Implemented** — real code does it on real records.
- **Verified** — Implemented, plus evidence a person can open (tests or a signed-in run).
- **Mockup only** — the prototype shows the shape; nothing behind it works.
- **Unmet** — nothing exists yet.

## Gate assessment

| Gate | State | Grounding |
| --- | --- | --- |
| C01 three-tab workflow | Mockup only | Production still ships eight tabs |
| C02 identity and old routes preserved | Unmet | No consolidation, so no redirects exist yet |
| C03 editable goal and read | Mockup only | Judgment is computed today but never human-editable |
| C04 long source and latest message | **Unmet, and actively wrong** | The thread read sorts oldest-first and stops at 40, then keeps 8 entries truncated at 900 characters. On a 63-message thread the newest request is never loaded |
| C05 every question accounted for | Unmet | No coverage model exists |
| C06 grounded commitments | Partly implemented | Commitments are retrieved into the draft context; nothing checks the draft against them |
| C07 version-anchored edits, race protection | Unmet | Drafts are a single mutable row; no version, no anchors |
| C08 Tai voice with the real sender | **Implemented but wrong for teams** | `ensureSignoff` appends "Trust, Tai" to any draft. A salesperson's message gets Tai's name |
| C09 evidence-backed private opportunities | Unmet in Comms | The pattern exists in Scout, not here |
| C10 situational humour | Unmet | No register-aware humour rule |
| C11 proposal arithmetic and scope | Unmet | No document review path at all |
| C12 truthful extraction, context-only files | Unmet | Attachment UI is for outgoing files only |
| C13 persistence and honest save failures | Partly implemented | Drafts persist; review state has nothing to persist |
| C14 authorized, version-bound, stale-on-change approval | Partly implemented | `comms-approval.ts` records who and when, and refuses legacy approvals. It is not bound to a version and not restricted by role: the database lets any organization member update a draft |
| C15 one approval, every send entrypoint gated | Partly implemented | The send function refuses anything not `approved`, but `comms-quick-reply.ts` writes `approved` itself and sends in the same breath, so a hand-typed reply never meets a reviewer |
| C16 truthful idempotent delivery | Partly implemented | The send function claims the row from `approved` before sending and rolls back on failure |
| C17 organization access, injection resistance | Partly implemented | Every read runs under the caller's token with RLS. Uploaded material is not yet treated as untrusted evidence |
| C18 persistent follow-up snooze and dismiss | Partly implemented | Attention state exists in Comms; not evidence-backed follow-ups |
| C19 scoped lesson promotion | Unmet | Voice examples are borrowed from the three newest approved drafts, unscoped and unpromoted |
| C20 honest provider failures | Implemented | Typed draft failures already map to distinct statuses and keep the person's words |
| C21 desktop and mobile usability | Mockup only | Verified on the prototype at 1440 and 375 |
| C22 model and prompt version evidence, regression evaluation | Unmet | The runtime reports provider and model; nothing records them per review or scores them |

Nothing in the prototype counts as functional AI. Its findings are written by hand
in a fixtures file.

## The next build slice: truthful context and the real sender

One slice, no new tables, no UI redesign. It fixes the two gates that make every
later gate meaningless: a reviewer reading the wrong 40 messages, and a reviewer
signing a salesperson's name as Tai.

1. **Newest-first thread loading.** Order `comms_messages` descending, take the
   newest window, re-sort ascending for the model. The 63-message thread must carry
   today's request. (C04)
2. **Full source coverage instead of a 900-character cut.** Keep long messages whole
   by sectioning them, and record what was read and what was skipped so a later
   review can say "not complete" honestly rather than implying full coverage. (C04, C12 groundwork)
3. **Sender identity.** Pass an explicit sender profile into drafting. `ensureSignoff`
   applies Tai's signature only when the sender is Tai; every other author keeps their
   own name. Mandatory voice rules stay for everyone. (C08)
4. **Coverage accounting, first pass.** Extract explicit questions from the loaded
   source and report which are addressed, as data on the draft response, not yet UI. (C05 start)
5. **Model evidence.** Record provider, model, prompt version and the source window
   on every draft run so C22 has something to evaluate later. (C22 groundwork)

Tests: newest-message selection on a long thread, whole-message retention, signature
by sender, coverage extraction, and provider evidence recorded.

## After that slice, in order

- **Slice 2, persistence.** New tables for review runs, immutable draft versions,
  findings and question coverage, plus an authorized-approver check that does not
  rely on the draft table's member-level policies. (C07, C13, C14, C19)
- **Slice 3, one gate.** Route quick reply and every other send entrypoint through the
  same reviewed-version approval. (C15, C16)
- **Slice 4, judgment depth.** Document review with arithmetic checked separately from
  prose, context-only ingestion, opportunities, humour rules. (C09, C10, C11, C12)
- **Slice 5, navigation.** Three tabs with old URLs redirecting, once the reviewer is
  real. (C01, C02, C03)

## Backend dependencies, all on the existing project

No new database. Supabase `okydosoacqdnursmmenf` keeps its 55 relationships,
44 threads, 419 messages and 45 drafts untouched by this slice.

- Slice 1 needs no migration.
- Slice 2 needs SQL authored here and applied by Tai: review runs, draft versions,
  findings, coverage, and a role-checked approval path, because the current draft
  policies let any organization member edit.
- Model selection stays as deployed until an evaluation set exists; the probe reports
  `openai/gpt-5-mini` today. Changing it without evidence would be a guess, and it
  would touch Scout, Steward and Studio, which share the runtime.

## Documentation

`docs/comms-review-progress.md` gains this gate table with the Implemented, Verified,
Mockup only and Unmet states, and is updated at the end of each slice with the evidence
behind any change.
