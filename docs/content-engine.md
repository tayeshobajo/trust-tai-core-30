# The Content Engine and the trusttai.com publish queue

Studio is the content room. One command becomes an editorial package, one
approval decides whether any of it exists publicly, and the website itself is
the only thing allowed to say a post is live.

## The path

```
Studio command            "Create 10 HIT blog posts around <keyword>"
  -> cluster plan         search intent, audience problem, why these belong together
  -> one post at a time   draft, rationale, SEO, internal links, CTA, image brief
  -> content_batches      Studio's own truth, written under the person's RLS
  -> Approvals            ONE blog_batch card with one child per post
  -> human decision       approve, skip, reject, per child
  -> Studio queue         approved -> queued, by the room that owns the work
  -> publisher            transport attempt with the stable publish key
  -> published            provider receipt with a canonical URL
  -> verified             the live URL was read back and carried the article
```

Every arrow after "human decision" is a separate state with its own evidence.
Approved is not queued. Queued is not published. Published is not verified.

## What the engine will not invent

- **No numeric HIT score.** There is a written rationale a person can disagree
  with. A number would imply a measurement nobody took.
- **No invented internal links.** Anchors are resolved against the real known
  pages passed into the run. Anything unmatched stays `resolved: false` with
  the reason, rather than becoming a URL.
- **No invented figures, clients or case studies.** The instructions forbid
  them and thin drafts surface as exceptions instead.
- **No claimed images.** No image provider is wired, so a post carries an image
  brief and alt text, and its image state is honestly `unavailable`. Batches
  that require an image mark those posts as exceptions, which a person then
  accepts or rejects.
- **A failed post does not lose the batch.** Each article is its own model
  call; a failure is recorded as `failed` with its reason and its siblings
  continue.

## The Approvals seam

`src/data/content/intake.ts` is the Marketing source adapter. It submits the
batch idempotently on the batch id, so submitting twice is one card. What
travels is the pointer and the facts, never the article body: each child item
carries `sourceEntity: { type: "content_item", id }`, word count, image state,
SEO state, unresolved link count and the rationale excerpt.

On approval, `executeContentBatch` in `src/data/approvals/execution.ts` reads
which children a person actually authorised and calls
`contentService.queueApproved`. Skipped and excepted posts are left exactly
where they were. Approvals never writes an article and never publishes.

## Publishing

`src/lib/content-publish.server.ts` holds the transport, because the publisher
credential must never reach the browser. Database work still runs as the
signed-in person, under RLS.

- Only a `queued` post may be sent.
- The stable `publish_key` travels as the publisher's idempotency key, and a
  post that already carries an `external_post_id` is never sent again.
- Every attempt is written to `content_publish_attempts` before and after the
  request, so a crash mid-flight is visible as an attempt.
- A failed attempt returns the post to `queued` with the reason attached.
- The publisher must return a canonical URL. Without one there is nothing to
  verify, and the post is not called published.
- Verification fetches that URL and requires the canonical path and the article
  title to match. Anything else leaves the post published and unverified.

Configure with `TRUST_TAI_PUBLISH_ENDPOINT` and `TRUST_TAI_PUBLISH_TOKEN`.
Until both exist, `GET /api/public/content/publish` reports `configured:
false` and Studio says so plainly rather than offering a button that lies.

## Rollout

Publish one controlled real article first, verify its canonical URL and date,
then scale the batch.

Schema: `docs/content-engine-schema.sql`.
