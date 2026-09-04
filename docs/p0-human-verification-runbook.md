# P0 human verification runbook

Four gates in P0 cannot be closed by the app. Each section below states the exact
human action, and the exact production evidence we will capture to upgrade the
ledger entry. Nothing here has been executed; this document only removes ambiguity.

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
`401 restricted_api_key`. There is therefore no safe provider-side log we can
read; delivery evidence must come from the recipient inbox plus our own
`activities` row.

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
`gmail.readonly` and `gmail.send`, and all three synced within the last hour.
So `sendCapability()` will report `canSend: true`.

One draft is already `review_state = approved` and unsent (the Megan reply,
`Re: Enquiries for Aspen New Zealand [#835]`). No draft has ever reached
`sent`: no `rationale.send` record exists anywhere, so no message has left
Trust Tai through Gmail in production.

**What Tai must do** (one real, low-risk governed reply)

1. Open Comms, pick a real relationship whose reply is genuinely wanted.
2. Read the draft, edit it if needed, and approve it. Approval is the gate; the
   agent never sends on its own.
3. Press Send. Confirm the mailbox the composer names is the one that owns the
   thread.
4. Press Send a second time on the same draft. It must replay the recorded
   outcome, not send a second message.

**Evidence we capture**

- The draft row at `review_state = 'sent'` with `rationale.send.state = 'sent'`,
  a `providerMessageId` and `providerThreadId`.
- The message visible in the sending mailbox's Gmail Sent folder with the same
  provider message id.
- The second press returning `replayed: true` and no second Gmail message.
- The corresponding activity row in the shared stream.

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
