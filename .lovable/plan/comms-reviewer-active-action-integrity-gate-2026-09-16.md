# Comms reviewer: active action-integrity gate

Extend the existing reviewer so it reads line by line and checks that words promising an
action, artifact or reference are actually backed by the outgoing message. Same Must fix /
Consider / Note surface, same approval readiness. No new tab, score or second review system.

## 1. New deterministic module

`src/domain/comms-action-integrity.ts`

```ts
export type ActionIntegrityProblem =
  | "missing_link" | "missing_attachment" | "missing_below" | "missing_destination";

export interface OutboundFacts {
  body: string;
  subject?: string | null;
  /** Null when attachment state cannot be verified (unbound manual review). */
  attachments: { filename: string; mimeType: string }[] | null;
  channel?: string | null;
}

export function actionIntegrityFindings(facts: OutboundFacts): ActionIntegrityFinding[];
```

Every finding: `kind: "action_integrity"`, `severity: "must_fix"`, an exact excerpt from the
body, a why, and a suggestion that never invents a URL, number, address or filename.

Rules, evidence-first and low noise:

1. **Link / CTA promise** — a sentence that tells the recipient to act at a target
   ("choose a time ... here", "book here", "use this link", "click here", "complete the form
   here", "schedule here", "see the link below", or a line ending `here:`). Fires only when
   the body contains no usable `http(s)://` URL after the promise. The bare word "here" used
   as ordinary prose ("we're happy to help here if needed") never fires: the promise pattern
   requires an action verb bound to the target.
2. **Attachment promise** — "attached", "see attached", "I've attached X". Fires only when
   attachment state is known (`attachments !== null`) and the list is empty. Never fires on
   an unbound review, where attachment state is unverifiable. A named file that clearly does
   not match staged files is left alone; unknown stays unknown.
3. **Below / following reference** — "see the details below", "the steps are below:", "use
   the information below" with nothing meaningful after the promise line. Fires only when the
   remaining text after the reference is empty or nothing but a sign-off.
4. **Contact / destination promise** — "call me at", "email X at", "send it to the address
   below" with no number, address or email actually supplied after it.

Plain text is the only representation this product stores, so the module states in its own
comment that visible http/https URLs are the only verifiable link targets and that a label
such as "Strategic Clarity Session With Tai - Tai Shobajo" is not treated as a hyperlink.

## 2. Wiring into the existing reviewer

`src/lib/comms-review.server.ts`

- When the session is bound to a draft, read the staged outgoing attachments through the
  existing `loadDraftForSend` + `readOutgoingAttachments`; pass filename and type only, never
  bytes, into the gate and into the model packet. An unbound session passes `null`.
- Run `actionIntegrityFindings` in the same deterministic floor block as the strategic gate,
  appended only when the model has not already raised a must-fix `action_integrity` finding.
- Add law 14 (action integrity) to `REVIEW_INSTRUCTIONS`, insert step 5 in the judgment order
  (action integrity before questions/promises/tone), and add `action_integrity` to the
  allowed finding kinds in the JSON contract.
- Bump `REVIEW_PROMPT_VERSION` to `comms-review/2026-09-16-action-integrity`.

## 3. Staleness

Add optional `attachmentStamp` to `ReviewContext` in `src/domain/comms-review.ts`, built from
the staged filenames, types, sizes and storage paths. It joins the fingerprint only when
files exist, so sessions with no attachments keep their current fingerprint exactly. Both
the run and the read compute it the same way, so a changed attachment set makes an old run
and an old approval stale. Approval still binds to the exact outbound payload as today.

## 4. Tests

`src/domain/comms-action-integrity.test.ts` covering the eight required cases: the exact
Sarena pattern, the same copy with a valid https URL, "I've attached invoice 481" with zero
staged files, the same with a PDF staged, "See the details below:" ending the message, "Call
me at" with no number, ordinary "here" prose, and a public-sector acknowledgement with a
valid booking URL and no price (no commercial and no action finding). Plus model-eval cases
added to `src/domain/comms-review-eval.ts` and its required-id list.

## 5. Documentation

New `docs/comms-action-integrity.md` with versioned criteria ACI01 to ACI07, marking what is
deterministic, what depends on real outbound metadata, what is model-evaluated and what still
needs Tai or live signed-in acceptance. C01 to C22 and S01 to S07 untouched.

## Out of scope

No UI change, no schema applied, no send, no publish, no new review system.
