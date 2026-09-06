# Comms P0-04: human-only send, manual-send reconciliation, relationship memory

Nothing is sent in this work. No migration. Megan's and Mental Dental's drafts are not touched.

## What the map shows today

The flow already exists end to end:

```text
Gmail sync (label-gated, bounded)
  -> comms_messages (provider ids, direction, occurred_at, snippet/body)
  -> relationship touch/thread reading (who owes whom, when late)
  -> drafting (judgment pass, then writing pass, grounded in
     thread + memory + open commitments + approved/sent examples)
  -> approvals intake (needs_human_review)
  -> human approval with durable provenance
  -> human-clicked Gmail send
  -> mailbox verification of drafts already marked sent
```

Already built, and staying as is:

- Send is human-triggered only. There is no background or agent send path: the send route requires a signed-in member's token, an approved draft with approval provenance, and a per-mailbox send capability check.
- Drafting is already grounded in more than the latest email: up to 40 prior messages in chronological order, observed/inferred/decided memory tiers, open commitments, and recent approved/sent wording as voice proof.
- A judgment layer already runs before writing (notice, understand, reflect, build, decide, with an ask gate) and is persisted on the draft's rationale.
- Mailbox verification already exists and is idempotent, and it already refuses ambiguous matches.

## The three real gaps

1. **Manual Gmail replies do not clear anything.** Verification only looks at drafts whose state is already `sent` inside Trust Tai. If Tai replies straight from Gmail, the prepared draft stays in `draft` / `needs_human_review` / `approved` forever and the relationship keeps showing "needs reply", even though the outbound message is sitting in `comms_messages`.
2. **Memory is per relationship only.** The relationship row carries `client_id`, but drafting never reads the client/project direction, decisions or commitments attached to it, so a project conversation is grounded in its own emails and nothing else.
3. **Nothing compounds after a verified send.** A verified outbound message leaves a stamp on the draft and no durable line in relationship/client memory, so the next draft cannot build on it.

## Plan

### 1. Human send policy (confirm and pin)

No behaviour change. Add tests that pin the law so it cannot regress: no send is reachable without a signed-in caller, an approved draft, and approval provenance; the scheduled sync pass performs reads and reconciliation only and can never call the send path.

### 2. Manual send reconciliation (the main change)

Extend the existing verification pass rather than adding a parallel system.

- Widen the candidate set from "drafts marked sent" to "open drafts" (`draft`, `needs_human_review`, `approved`) alongside the existing sent ones, per relationship.
- Add a second matcher in `src/domain/comms-verification.ts` for open drafts. It is deliberately stricter than the sent-draft matcher, because here nobody claimed a send:
  - the outbound message must be newer than the draft's creation,
  - it must be addressed to the relationship's email,
  - it must agree on the Gmail thread when the draft carries a `provider_thread_id`, or on subject otherwise,
  - if two open drafts could claim the same message, or one draft could claim two, nothing is matched.
- Matched drafts get an additive `rationale.external_send` stamp: state `sent_externally`, provider message id, provider thread id, the observed send time, the signals that carried the match, and reconciled-at. The `review_state` column is not extended and no check constraint is touched (the P0-08 lesson). The write is conditional on the stamp being absent, so repeated syncs are idempotent.
- Verification vocabulary is preserved: an external send is Executed and Verified by provider evidence, never Human Accepted, and the stamp says so.

### 3. Relationship and project memory layer

Add one bounded context builder, `src/lib/comms-context.server.ts`, used by drafting:

- selects, with the caller's token: the chronological thread already loaded, the linked client/project direction and current decisions, open commitments on both sides, the last verified outbound messages (including externally sent ones), and the relationship's recorded preferences,
- bounds it: newest-first selection inside per-source caps, then re-sorted into chronology, with a total character budget, so no history dump reaches the model,
- labels every line as evidence (observed / decided / human) or interpretation, and the drafting instructions keep interpretation out of `factsAllowed`,
- produces a short trajectory summary: what was promised, what is still open, what changed, what looks like the next step. This feeds the existing judgment pass; it does not become new UI.

Drafting keeps failing closed: when the layer is thin, the grounding gate refuses as it does now.

### 4. Knowledge compounding

Only on evidence. When a draft becomes verified (Trust Tai send verified in the mailbox, or externally reconciled), write one durable line through the existing memory/activity primitives on the relationship, and to the linked client when there is one: what was communicated, when, and the provider message id. Unsent drafts write nothing.

### 5. UI and state

Small, evidence-backed additions only:

- the draft shows "Sent outside Trust Tai, seen in the mailbox" with its date when the external stamp exists, using the existing provenance label function,
- a reconciled draft no longer counts as an open reply obligation in the queue, inbox views and attention list,
- no new pages.

### 6. Tests

- external matcher: matches on thread id, matches on subject plus recipient, refuses when the message predates the draft, refuses when two drafts are plausible, refuses inbound,
- reconciliation write: sets the stamp once, a second pass changes nothing, only the matched draft changes, no send call is made,
- verification law: an externally reconciled draft is Verified and not Human Accepted, and cannot be sent afterwards,
- context layer: stays inside its caps, keeps chronology, keeps interpretation out of facts, omits absent sources without inventing them,
- compounding: writes one memory line per verified send, nothing for unsent drafts,
- send law: unchanged, still refuses without a human and provenance.

### 7. Runtime verification

Read-only against production after the change: run one sync pass for a relationship with a known manual Gmail reply, then read the draft row and confirm the stamp, its provider ids, and that no send attempt exists; run the pass again and confirm the row is byte-identical; confirm Megan's and Mental Dental's drafts are unchanged unless a genuine provider match exists, and report it before anything is treated as resolved.

## Migration

None. Everything lands in the existing `rationale` JSON and existing memory/activity primitives. No enum or check-constraint change, no destructive DDL.

## Files

- `src/domain/comms-verification.ts` (new external matcher, additive types)
- `src/lib/comms-gmail.server.ts` (widen the reconciliation pass)
- `src/lib/comms-context.server.ts` (new bounded context layer)
- `src/lib/comms-draft.server.ts` (consume the layer)
- `src/data/comms-queue.ts`, `src/data/comms-inbox.ts`, `src/data/comms-attention.ts` (treat reconciled drafts as resolved)
- `src/components/tt/comms/send-composer.tsx` and the draft card (status line)
- new/extended test files alongside each
