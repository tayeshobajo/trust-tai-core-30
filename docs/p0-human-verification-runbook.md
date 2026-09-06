# P0 human verification runbook

Two gates in P0 remain open and cannot be closed by the app: P0-03 and P0-04.
Each open section below states the exact human action and the exact production
evidence we will capture to upgrade the ledger entry. Sections 3 and 4 (P0-07
and P0-08) are now closed and kept only as the record of what was verified; no
action remains there.

Last reconciled with production state on 2026-09-06.

---

## 1. Invite email (P0-03)

**Current production evidence.** The path has already run for real. On
2026-08-24 an invitation to `diamond@trusttai.com` was created (`user.invited`)
and the email attempt was recorded one second later (`user.invite_emailed`,
`delivered: false`). The recorded refusal is exact:

> This API key is not authorized to send emails from trusttai.com

So the code path, the audit trail and the provider call are all proven. The only
failure is sender-domain authorisation, not wiring.

The stored `RESEND_API_KEY` is a **send-only restricted key**: a read-only
`GET /domains` through the connector gateway returns
`401 restricted_api_key`. Re-checked on 2026-09-06 through the linked Resend
connection (`tayeshobajo@gmail.com`): still `401`, "This API key is restricted
to only send emails". There is therefore no safe provider-side log we can read;
delivery evidence must come from the recipient inbox plus our own `activities`
row. If Tai wants us to see domain status directly, the Resend key needs read
permission added in the Resend dashboard, or a full-access key linked instead.

**What Tai must do**

1. In Resend, add and verify `trusttai.com` (or a subdomain such as
   `mail.trusttai.com`) as a sending domain, and add the DNS records it asks for.
   If the sending address becomes a subdomain, set `INVITE_EMAIL_FROM` to match.
2. In Settings, People, open the pending invitation for `diamond@trusttai.com`
   and press Resend, or create a fresh invitation to an address you control.
3. Confirm the email arrives, and that the sign-in link opens
   `https://cmd.trusttai.com` and signs the recipient in.

**Evidence we capture to upgrade to Human Accepted**

- A new `user.invite_emailed` activity row with `payload.delivered = true` and a
  `payload.provider_id` present.
- The recipient's confirmation that the message arrived (screenshot or reply).
- The invitation row moving from `pending` once the person signs in.

---

## 2. Gmail governed reply (P0-04)

**Current production evidence.** Re-consent is already done and does not need
repeating. All three connected mailboxes
(`tayeshobajo@gmail.com`, `hello@trust-tai.com`, `tai@trust-tai.com`) are
`status = connected` and hold both
`gmail.readonly` and `gmail.send`. So `sendCapability()` reports
`canSend: true`.

The human-send law now stands end to end: Comms drafts, flags and prepares, and
only a human click sends. Since 2026-09-06, approving a draft writes durable
approval provenance (`rationale.approval`: who approved and when) in the same
operation as the state change, and a draft marked approved **without** that
provenance is legacy-unverified and refuses Send until a person re-approves it.
The previously approved Megan reply (`Re: Enquiries for Aspen New Zealand
[#835]`, draft `cdb7166f-6fec-4d71-9aca-cd77c4ace3eb`) is in exactly that
state: approved before provenance existed, so opening it will ask for a fresh
approval before Send unlocks. Its thread has also moved on, so it is not the
recommended candidate.

A governed draft is already prepared and waiting for review on the live Mental
Dental thread: draft `2ea4925f-ae67-4fda-9252-0c74787dfcd4`,
`Re: Input Items`, `review_state = needs_human_review`, bound to relationship
`0e0f3565-a436-4cbf-9523-a519aa21b4d4` and Gmail thread `19f437572010740d`,
with no approval and no send record. No draft anywhere carries a
`rationale.send` record, so no message has ever left Trust Tai through Gmail in
production.

Manual replies sent in Gmail outside Trust Tai are now reconciled on sync
(commit `be63741d`): when a later outbound message uniquely matches a waiting
draft on thread, person and time, the draft closes as replied-from-Gmail and
Send is suppressed on it. Ambiguous matches fail closed and do nothing; repeats
are idempotent.

**What Tai must do.** Either path closes the gate; path A is the fuller proof.

Path A, governed send from Comms:

1. Open Comms and open the Mental Dental draft (`Re: Input Items`).
2. Read it against Lauryn's latest email, edit if needed, then approve it. Your
   name and the time are recorded as the approval. The agent never sends on its
   own.
3. Press Send. Confirm the composer names `tayeshobajo@gmail.com`, the mailbox
   that owns the thread.
4. Press Send a second time on the same draft. It must replay the recorded
   outcome, not send a second message.

Path B, manual send in Gmail:

1. Reply to the Mental Dental thread directly in Gmail.
2. Let the next Comms sync run (or trigger one). The waiting draft should close
   as replied-from-Gmail with the message date, and Send on it stays closed.

**Evidence we capture**

- Path A: the draft at `review_state = 'sent'` with `rationale.send.state =
  'sent'`, a `providerMessageId` and `providerThreadId`; the durable
  `rationale.approval` naming Tai; the message visible in the mailbox's Gmail
  Sent folder with the same provider id; the second press returning
  `replayed: true` with no second Gmail message; the corresponding activity row
  in the shared stream.
- Path B: the draft carrying `rationale.external_send` with the provider message
  id and timestamp; no `rationale.send`; a repeated sync creating no second
  record; the relationship memory line written exactly once.

---

## 3. Publisher endpoint handoff contract (P0-07)

**Why this stays blocked.** `trusttai.com` is a Next.js site served from
Cloudflare and is not part of this repository or of any Lovable project on this
account. `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN` are absent,
and `GET /api/public/content/publish` correctly reports
`endpointConfigured: false`. There is no safe way to invent this publisher from
inside Trust Tai OS. What follows is the exact contract the external
implementation must satisfy; nothing else needs to change here.

**Endpoint.** One HTTPS POST route on trusttai.com, for example
`https://trusttai.com/api/trust-tai/publish`.

**Auth.** `Authorization: Bearer <TRUST_TAI_PUBLISH_TOKEN>`. A single shared
secret, chosen by the site owner, stored in this project as
`TRUST_TAI_PUBLISH_TOKEN`. Any other or missing token must return `401`.

**Idempotency.** Every request carries the same value in the
`idempotency-key` header and in the `idempotency_key` body field. The publisher
must treat that key as the post's identity: a repeat with the same key must
return the **same** receipt for the **same** post and must not create a second
post.

**Request body** (JSON):

```json
{
  "idempotency_key": "content:<batchId>:<slug>",
  "slug": "string",
  "title": "string",
  "seo_title": "string",
  "meta_description": "string",
  "body_markdown": "string",
  "category": "string",
  "tags": ["string"],
  "image": { "url": "string|null", "alt": "string" }
}
```

**Success response** (`200` or `201`, JSON). Must contain a canonical URL and a
stable post id; either field name in each pair is accepted:

```json
{
  "url": "https://trusttai.com/insights/<slug>",
  "id": "<publisher post id>",
  "published_at": "2026-09-04T12:00:00.000Z"
}
```

A `2xx` without a canonical URL and an id is treated as a failure: the post
returns to `queued` and nothing is called published.

**Failure.** Any non-2xx is recorded verbatim in the attempt ledger with its
status and the first 200 characters of the body, and the post returns to
`queued`. The publisher must never partially publish.

**Verification expectation.** The canonical URL must serve `200 text/html`
containing the article title to an unauthenticated `GET`, within a few minutes
of the receipt. Trust Tai reads it back independently before calling the post
verified.

**Handover.** Once the route exists, add `TRUST_TAI_PUBLISH_ENDPOINT` and
`TRUST_TAI_PUBLISH_TOKEN` as runtime secrets here. No code change is required.

---

## 4. Controlled article verification (P0-08)

Do not attempt this until P0-07 is live. **P8-03, featured image generation, is
not a blocker**: `image.url` is nullable in the publish payload and
`publishQueuedItem()` never asks whether an image exists. An article can be
published without one, with a slightly weaker social card. P8-03 stays
post-launch.

**Sequence, once the publisher answers**

1. In Approvals, open the pending content batch
   (`apr_pm7t4kmdmtn2ygo1`, 10 posts, currently `needs_review`) and approve
   exactly one post, or produce a single fresh post and approve that one.
2. Confirm the item is `state = 'queued'` in `content_items` and carries a
   `publish_key`.
3. In Studio, press Publish for that one post only.
4. Expected ledger: one new `content_publish_attempts` row, id `cpa_...`,
   moving `attempted` then `executed`, with a receipt containing
   `canonicalUrl`, `externalPostId` and `publishedAt`.
5. Press Publish again on the same post. It must resolve to the same receipt
   with no second attempt and no second post on the site.
6. Run the verify action. It fetches the canonical URL unauthenticated and must
   see the article.
7. Open the canonical URL in a browser yourself and read the post.

**Evidence we capture**

- The `content_publish_attempts` row with state `executed` and its receipt.
- The `content_items` row at the published state with its canonical URL.
- An independent unauthenticated `200` read of that URL returning the article.
- The second press proving idempotency.

Only then is P0-08 Human Accepted.
