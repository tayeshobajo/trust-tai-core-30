# Website → Scout signal boundary

TrustTai.com is a **signal source**, not another operating system.

```
Website   attention + intake            (owns)
Scout     inbound prospect qualification (owns)
Roadmap   direction                      (owns)
Projects  execution                      (owns)
```

A website submission never creates a Roadmap, a Project, or a qualification.
It creates one thing: an inbound signal that Scout can act on.

## Receiver

| | |
|---|---|
| Intake endpoint | `POST https://cmd.trusttai.com/api/public/website/intake` |
| Events endpoint | `POST https://cmd.trusttai.com/api/public/website/events` |
| Auth | HMAC-SHA256 over `` `${timestamp}.${rawBody}` `` |
| Headers | `x-trust-tai-signature: sha256=<hex>`, `x-trust-tai-timestamp: <unix seconds>`, `content-type: application/json` |
| Clock skew | 300 seconds |
| Idempotency | `submission_id` (intake), `event_key` (events) |

The organization is **server configuration**, never payload. If the body
carries `organization_id` and it differs from the configured organization the
request is rejected `403 organization_mismatch`.

### Core secrets

| Secret | Purpose |
|---|---|
| `WEBSITE_INTAKE_SECRET` | shared HMAC secret; also set on TrustTai.com |
| `WEBSITE_INTAKE_ORGANIZATION_ID` | the one organization inbound signals belong to |

Without either, the receiver answers `503 not_configured` and stores nothing.

### Intake response

```json
{ "accepted": true, "scout_prospect_id": "uuid|null", "duplicate": false,
  "link_state": "linked|unlinked", "because": "Matched on the company domain example.com." }
```

`201` first time, `200` on a replay. A replay is never a second record and
never a second prospect.

### Event contract

`page_view`, `intake_view`, `intake_started`, `intake_answered`,
`intake_resume_requested`, `intake_resumed`, `intake_submitted`,
`intake_abandoned`.

```json
{ "source_app": "website",
  "events": [{ "event_name": "intake_answered", "event_key": "sess_1:q3:1",
               "occurred_at": "2026-08-20T09:12:00Z", "session_id": "sess_1",
               "path": "/roadmap", "referrer": "https://linkedin.com",
               "utm": {"source": "linkedin", "campaign": "founders"},
               "device": "mobile", "submission_id": "sub_1",
               "question_id": "q3", "modality": "voice", "properties": {} }] }
```

`event_key` must be stable for the same happening. Retries are deduplicated on
`(organization_id, event_key)`.

## Persistence

Canonical entities are reused, not duplicated:

- company / prospect identity → `public.prospects` (unchanged)
- history → `public.activities` (`app_key = 'website'`)

New, bounded (`docs/website-signals-schema.sql`):

- `public.website_intake_submissions` — raw inbound intake, provenance,
  idempotency, and the Scout link or the deliberate non-link
- `public.website_events` — the small attention/funnel vocabulary

Both are org-scoped with RLS: members read, only the service role writes.

## Routing into Scout

Evidence-backed matching only (`src/domain/website-matching.ts`):

1. company website domain, else a **work** email domain (free mailboxes are
   not evidence)
2. exactly one prospect on that domain → link
3. no prospect on that domain → create an inbound prospect,
   `status = 'discovered'`, `source = 'website_roadmap_intake'`
4. more than one, or no domain at all → keep the submission as an **unlinked**
   Scout signal for a person to review

Provenance is structural on the prospect (`provenance.source_app`,
`source_channel`, `source_type`, `submission_id`), not just a tag. The friendly
label is `Website · Roadmap Intake`.

## What TrustTai.com must implement

1. Store the shared secret server-side; sign every request. Never call the
   receiver from a browser.
2. Emit the event vocabulary above with stable `event_key`s and first-touch
   attribution carried in the session.
3. POST the completed intake once, with `submission_id` stable across retries,
   and retry on 5xx with the same id.
4. Preserve verbatim answers exactly; do not summarise before sending.
5. Never call any other Core endpoint. This is the whole boundary.
