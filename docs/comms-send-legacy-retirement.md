# Retiring the deployed `comms-send` edge function

Status: **prepared, not deployed.** The replacement body is
`supabase/functions/comms-send/guarded.index.ts`. The original
`supabase/functions/comms-send/index.ts` is untouched, and nothing here has
been applied to the shared Supabase project.

## Why

`comms-send` is deployed and active (v5) on `okydosoacqdnursmmenf`. It:

- runs with the service role, so RLS does not apply to anything it does;
- treats `comms_drafts.review_state = 'approved'` as proof of approval, and
  any member can write that value from a browser;
- does not verify that the caller is a member of the organization that owns
  the draft it is asked to send.

No code in this app calls it any more — the queue, Scout outreach and the
inbox all go through `/api/public/comms/send`, which uses the shared send
authority. Replacing those call sites did **not** retire the function: it is
still reachable by anyone with a session token.

## Inventory of send paths as they stand

| Path | Entry point | Goes through the shared authority? |
| --- | --- | --- |
| Comms queue | `/api/public/comms/send` → `sendDraftViaResend` | yes |
| Scout outreach | `/api/public/comms/send` → `sendDraftViaResend` | yes |
| Gmail send / reply | `/api/public/comms/gmail/send` → `sendDraftViaGmail` | yes |
| Inbox quick reply | draft → bound review → Gmail send | yes |
| LinkedIn mark-sent | `recordLinkedinSend` | yes (human attestation, labelled as such) |
| Scheduled sends | none exist in this app | n/a |
| Deployed `comms-send` edge function | direct HTTP to Supabase | **no — still live, this document** |

## Deployment steps (Codex)

1. Note the current deployed version number of `comms-send` so it can be
   restored: `supabase functions list --project-ref okydosoacqdnursmmenf`.
2. Copy `supabase/functions/comms-send/guarded.index.ts` over
   `supabase/functions/comms-send/index.ts` in the deployment checkout — or
   deploy from a branch where that swap has been made. Do not delete the
   function: deleting it turns a clear refusal into an opaque 404, and removes
   the ability to roll back in place.
3. Deploy: `supabase functions deploy comms-send --project-ref okydosoacqdnursmmenf`.

## Tests after deployment

1. **Refusal:** call the function with a valid session token and a real draft
   id. Expect HTTP 410, body `{"retired": true, ...}`, and **no** email at the
   recipient, **no** new `comms_messages` row, and no change to
   `comms_drafts.review_state`.
2. **Preflight:** an `OPTIONS` request returns 200 with the CORS headers, so a
   browser caller sees the 410 body rather than a CORS error.
3. **The supported path still works:** with a draft that has a bound review,
   a completed run and an approval naming that exact payload, POST
   `/api/public/comms/send` and confirm it sends, and that a second identical
   POST returns `duplicate` without sending again.
4. **Nothing else broke:** confirm no other Supabase function, database
   trigger, `pg_cron` job or external service invokes `comms-send`
   (`select * from cron.job;` and a search of the other function bodies).

## Rollback

Redeploy the previous version from the function's version history, or restore
`index.ts` from git and deploy again. Nothing in this app depends on either
version, so rollback affects only external callers.
