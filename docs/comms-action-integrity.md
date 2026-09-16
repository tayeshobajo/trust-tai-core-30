# Comms reviewer extension: active action integrity (ACI01 to ACI07)

Versioned extension to the Comms reviewer contract. C01 to C22 and S01 to S07 keep their
original meanings and are not edited by this round.

Reviewer prompt version: `comms-review/2026-09-16-action-integrity`.

## The principle

A passive reviewer judges grammar, tone and structure. An active one reads the way the
recipient will: line by line, asking of each sentence what it causes the reader to expect, and
whether that thing is actually present and usable in the outgoing message.

The miss that prompted this: a teammate wrote "You can choose a time that works for both of
you here:" followed only by the title "Strategic Clarity Session With Tai - Tai Shobajo". The
sentence promises somewhere to go. Nothing followed it. A person reading line by line sees it
at once.

## What is checked

Deterministic gate: `src/domain/comms-action-integrity.ts`, mirrored by law 14 and step 5 of
the judgment order in `REVIEW_INSTRUCTIONS`. Findings use the existing surface: kind
`action_integrity`, severity `must_fix`, an exact excerpt from the draft, a reason, and a
suggestion that never invents a URL, number, address or filename. A must-fix finding blocks
approval through the unchanged readiness gate. No new tab, score, badge or dashboard.

| ID | Criterion | Evidence level |
| --- | --- | --- |
| ACI01 | A link or CTA promise ("choose a time here", "book here", "click here", "complete the form here", a line ending `here:`) with no usable http or https address in the outgoing body raises a must-fix `action_integrity` finding quoting the promising words. No URL is invented. | CODE, deterministic and model |
| ACI02 | The same wording raises nothing when a usable address really is in the message. | CODE, deterministic and model |
| ACI03 | "attached", "see attached", "I've attached X" raises a must-fix finding only when the staged file set is known and empty. Files present raises nothing merely because the word appears. A named file that does not obviously match staged files is left alone: unknown stays unknown. | CODE for the rule, PERSISTED-DEPENDENT for the staged set |
| ACI04 | A pointer to content "below" or "following" with nothing meaningful after it (a sign-off and a name do not count) raises a must-fix finding. Ordinary prose does not. | CODE, deterministic and model |
| ACI05 | A promise of a concrete destination ("call me at", "email X at", "the address is below") with no number, address or link supplied raises a must-fix finding. | CODE, deterministic and model |
| ACI06 | Keyword-only behaviour is forbidden. The bare word "here" or "attached" in ordinary prose raises nothing, and a safe public-sector acknowledgement with a valid booking address raises neither an action nor a commercial finding. | CODE, deterministic and model |
| ACI07 | Action-integrity evidence goes stale when the outbound artifacts move. The staged file set enters the existing review context fingerprint, so changing, adding or removing a file invalidates an earlier run and an earlier approval. Changed link text already changes the body and therefore the version. Approval still binds to the exact outbound payload, through the same payload fingerprint as before. | CODE |

## What the reviewer can actually see

This product stores plain text message bodies. There is no rich-anchor representation, so the
only verifiable link targets are visible http and https addresses, and a label that reads like
a link title is never treated as a hyperlink. The module says so in its own comment. If a
richer representation is stored later, it should be inspected here rather than flattened
before review.

For a review bound to a real Comms draft, the packet's `delivery` section carries: the channel,
every address visible in the body, whether the staged file set could be read, and the staged
filenames and types. Metadata only; no bytes are read and none reach the model.

For a manual or unbound review, or when the draft read fails, `attachmentsKnown` is false. The
reviewer may still catch a missing visible address from the text, and is instructed never to
claim there is no attachment. The deterministic gate stays silent on attachments in that case.

## Proof

- Deterministic: `src/domain/comms-action-integrity.test.ts`, 17 tests covering all eight
  required regression cases plus the fingerprint stamp behaviour.
- Model evaluation: eight cases added to the fixed set in `src/domain/comms-review-eval.ts`
  (`promised_link_missing`, `promised_link_present`, `promised_attachment_missing`,
  `promised_attachment_present`, `promised_details_below_missing`, `promised_number_missing`,
  `ordinary_here_no_flag`, `public_sector_acknowledgement_with_link`), pinned in
  `src/domain/comms-review-eval.test.ts`. These are written down, not yet run against a
  provider.
- Whole suite, types and build pass on this candidate.

## Still open

| Item | Owner |
| --- | --- |
| A live provider run of the eight new evaluation cases | Blocked, needs a working gateway run |
| A signed-in run on a real bound draft, proving the staged file set reaches the gate and that changing a file makes an earlier approval stale | Codex |
| Tai's acceptance of the wording of the new findings | Tai |

No database change was applied, nothing was sent or published, and no production verification
is claimed.

## Changed files

- `src/domain/comms-action-integrity.ts` (new)
- `src/domain/comms-action-integrity.test.ts` (new)
- `src/domain/comms-review.ts` (optional `attachmentStamp` in the context fingerprint)
- `src/lib/comms-review.server.ts` (staged file read, delivery packet section, deterministic
  floor, law 14, judgment order, prompt version)
- `src/domain/comms-review-eval.ts`, `src/domain/comms-review-eval.test.ts`
- `docs/comms-action-integrity.md` (this file)
