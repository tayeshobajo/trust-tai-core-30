# Paperclip production host: what Trust Tai OS needs to switch to LIVE

Trust Tai OS cannot provision infrastructure from inside the app. This document is
the exact contract the app already expects, so that the moment a reachable host
exists, Paperclip flips from SYNCHRONIZED to LIVE with a single environment
variable and no code change.

## Why it is permanently SYNCHRONIZED today

`PAPERCLIP_API_URL` defaults to `http://127.0.0.1:3100`. Trust Tai OS server code
runs in a hosted edge runtime, so loopback resolves to the runtime itself, never
to the laptop running Paperclip. The live probe therefore always fails and the
room correctly falls back to the reconciled projection. Settings, Diagnostics now
states this plainly: it shows the configured Paperclip origin and flags a loopback
or non-TLS origin.

## What the host must provide

1. A stable public origin over TLS, for example `https://paperclip.trusttai.com`.
   Self-signed certificates will not work; the runtime rejects them.
2. `GET /api/health` returning `200` for an authorized caller. This is the only
   endpoint the live probe uses.
3. The existing board API routes already used by `src/lib/paperclip-client.server.ts`
   (`/api/agents`, `/api/issues`, run and comment routes).
4. Bearer authentication using the same `PAPERCLIP_BOARD_KEY` value already stored
   as a Trust Tai OS runtime secret.
5. Process supervision (systemd, Docker restart policy, or equivalent) so the API
   answers continuously rather than while a laptop is awake.
6. Outbound reachability from the Trust Tai OS runtime: no VPN-only network, no IP
   allowlist that excludes the hosting platform.

## Switching over

1. Deploy Paperclip behind TLS on the VPS.
2. Confirm from outside the VPS:
   `curl -sS -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $PAPERCLIP_BOARD_KEY" https://paperclip.trusttai.com/api/health`
   must print `200`.
3. Add the runtime secret `PAPERCLIP_API_URL=https://paperclip.trusttai.com` to
   this project.
4. Reload Settings, Diagnostics. Paperclip mode should read live, the host row
   should show the public origin with no loopback note, and Steward, Agents should
   label itself `Paperclip · live`.

No reconciliation cadence, hosting model, or fallback path changes. If the host
goes down, the app returns to SYNCHRONIZED and then INTERRUPTED exactly as before.
