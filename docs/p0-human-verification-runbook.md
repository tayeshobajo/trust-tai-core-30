# P0 human verification runbook

One gate in P0 remains open and cannot be closed by the app: P0-04. Its
section below states the exact human action and the exact production evidence
we will capture to upgrade the ledger entry. Section 1 (P0-03) and sections 3
and 4 (P0-07 and P0-08) are now closed and kept only as the record of what
was verified; no action remains there.

Last reconciled with production state on 2026-09-06.

---

## 1. Invite email (P0-03) — CLOSED, Human Accepted 2026-09-06

**Closed by Tai's explicit confirmation:** "All good now, i'm able to login
after receiving the invite and the sign in links work as well." A real
production invitation to Tai's alternate address `tayeshobajo@gmail.com`
arrived in the inbox, the branded Supabase magic-link sign-in email arrived,
the magic link authenticated the invited address, the repaired
identity-driven invitation claim created/recognized the workspace membership
correctly, and the Trust Tai OS production workspace opened. The gate is the
invite email end-to-end workflow, not a specific recipient identity, so the
alternate-address run closes it. The Diamond run below is kept as the
historical record of the path and its repair. No action remains.

**Historical production evidence.** The path has run for real. On
2026-08-24 an invitation to `diamond@trusttai.com` was created (`user.invited`)
and the first email attempt was recorded one second later (`user.invite_emailed`,
`delivered: false`) with the exact refusal:

> This API key is not authorized to send emails from trusttai.com

On 2026-09-06 Tai created a new Resend connection with a replacement sending
key, it was linked to this project, the key passed a live gateway credential
check (no email sent), and Tai pressed Send again on the same invitation. The
row now shows **Emailed** with "The email provider accepted this invitation
email." That sentence renders only from a durable `user.invite_emailed`
activity with `delivered = true` recorded against that invitation id, so a
successful attempt is now in the audit stream. The retry reuses the existing
invitation by id and the send route refuses anything not `pending`, so no
duplicate invitation can have been created, and the invitation stays `pending`
until Diamond accepts and signs in.

The Resend key in play is send-only by design; there is no provider-side log
we can read. Delivery evidence therefore comes from our own `activities` row
plus the recipient's inbox.

**What Tai must do**

1. ~~Verify the sending domain / replace the sending key~~ — done 2026-09-06.
2. ~~Press Send again on the pending invitation~~ — done 2026-09-06, provider
   accepted.
3. ~~Confirm the email arrives in Diamond's inbox~~ — done 2026-09-06,
   screenshot evidence from Tai: the invitation email is in Diamond's Gmail
   inbox, from `invites@trusttai.com`, subject "Tai invited you to Trust Tai
   on Trust Tai OS", 11:58 AM, content and button visible.
4. Have the recipient open the sign-in link and sign in; confirm the
   invitation leaves `pending`.

**2026-09-06, acceptance path repaired.** Step 4 was blocked: the emailed link
landed on the generic sign-in screen, and because Tai's own session was still
active in that browser the recipient saw "no Trust Tai organization membership
exists for this account". Nothing consumed the invitation. The link now carries
the invited address and the invitation id (neither is a credential: acceptance
still requires a verified Supabase session on that exact address), and `/auth`
reads them:

- signed in as a different address: the screen names the invited address and
  the current one, grants nothing, and offers sign out and switch account
- not signed in: the invited address is shown and locked, and the one-time link
  returns to the same invitation
- signed in as the invited address: `POST /api/public/settings/invite-accept`
  verifies the bearer token against Supabase Auth, evaluates the invitation
  through `src/domain/invite-acceptance.ts`, upserts the membership once with
  the invited role and app access, marks the invitation `accepted`, and opens
  the workspace

Acceptance is idempotent: the membership write is an upsert on
`(organization_id, user_id)`, an existing membership keeps its current role, and
the invitation is patched only while it is still `pending`. Expired, cancelled
and already accepted invitations keep telling the truth. No migration was
needed; `status`, `accepted_at` and `app_access` already exist.



**Evidence we capture to upgrade to Human Accepted**

- A new `user.invite_emailed` activity row with `payload.delivered = true` and a
  `payload.provider_id` present. **Met in substance 2026-09-06** (the Emailed
  state proves `delivered = true`; `provider_id` still to be read back).
- The recipient's confirmation that the message arrived (screenshot or reply).
  **Met 2026-09-06** (Tai-provided screenshot of the email in Diamond's Gmail
  inbox, 11:58 AM, from `invites@trusttai.com`).
- The invitation row moving from `pending` once the person signs in.
  **Outstanding.** Direct read of the row is refused by RLS to anonymous
  callers; sign-in is not yet evidenced, so the gate stays open.

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

## 3. Publisher endpoint handoff contract (P0-07) — CLOSED, Production Verified 2026-09-05

**Closed.** Both secrets are present and non-empty in the runtime; the
`cmd.trusttai.com` publisher status endpoint reports configured; an
authenticated handshake to the trusttai.com endpoint with an invalid body
returned the exact validation refusal, proving auth reaches validation. No
action remains. The contract below is kept as the reference for what the
external endpoint satisfies.

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

## 4. Controlled article verification (P0-08) — CLOSED, Human Accepted 2026-09-06

**Closed.** Exactly one article (`citm_da7jlq4nmtn2yer2`, "How Trust Tai
prioritizes roadmap milestones so founders free the most time first") was
approved by Tai through the flagged-item override path, moved approved -> queued
-> published -> verified through the canonical transitions, and published once
on the stable key `content:cbat_ffebutsjmtn2ydym:prioritize-roadmap-milestones-trust-tai`.
The ledger holds exactly `attempted` then `executed` for that key; an immediate
replay resolved to the same receipt with no second attempt. The canonical URL
https://trusttai.com/insights/prioritize-roadmap-milestones-trust-tai returns
200 unauthenticated with the exact title and body. The other nine batch items
remain `exception` and unpublished. Full evidence in `roadmap.md`, P0-08. No
action remains; the sequence below is kept as the record of what was executed.
