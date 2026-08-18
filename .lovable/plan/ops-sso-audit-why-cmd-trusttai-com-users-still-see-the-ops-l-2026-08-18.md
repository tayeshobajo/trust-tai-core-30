# Ops SSO audit: why cmd.trusttai.com users still see the Ops login

Audit only. No code changed. Findings come from reading this repo and from inspecting the live Ops bundle at `https://ops.trusttai.com/assets/index-BN_hglrK.js`.

## Root cause (confirmed)

The Ops app only trusts these two Trust Tai OS origins, baked into its build as `VITE_OPS_OS_ORIGINS`:

```text
https://65944e34-ede5-4757-befb-870e1ff97444.lovableproject.com
https://id-preview--65944e34-ede5-4757-befb-870e1ff97444.lovable.app
```

`https://cmd.trusttai.com` is not in that list. Consequences on the live Ops `/sso` screen:

1. Ops announces readiness with `postMessage({type:"trust-tai-ops:sso-ready"}, origin)` looping only over that allowlist, so the ready message is never delivered to the production Core window.
2. Even if it were, Ops validates `event.origin` against the same list and returns `origin_rejected`.

Core therefore never completes the handshake (fails with `no_ack` after 15s) and Ops falls back to its own email/password screen. The fix is an Ops-side environment change, not a Core code change.

## 1) How Core launches Ops today

- `src/components/tt/ops/launch-ops.tsx` (`LaunchOpsButton`) and `src/routes/modules.ops.tsx` (line 114) read the live session via `supabase.auth.getSession()` and call `launchOps(...)`.
- `src/lib/ops-launch.ts` (`launchOps`) opens `https://ops.trusttai.com/sso` in a `_blank` tab with `noopener=no` (so `window.opener` survives), waits for the ready message, then posts the payload to the exact Ops origin.
- Constants in `src/domain/ops.ts`: `OPS_ORIGIN`, `OPS_SSO_PATH = "/sso"`, `OPS_READY_MESSAGE = "trust-tai-ops:sso-ready"`, `OPS_SESSION_MESSAGE = "trust-tai-os:sso"`.
- Deep links: `src/data/ops/destination.ts` (`opsPathOf`) and `safeOpsTargetPath` in `ops-launch.ts` reduce an Ops URL to a path-only route hint.

## 2) Is there a session/token handoff?

Yes, and it is implemented on both sides.

- Core posts the current Supabase access token to the Ops origin after Ops acknowledges.
- Ops validates the message, then calls its edge function `os-sso-exchange` with `{osAccessToken, osOrganizationId, canonicalProjectId}`, receives `{tokenHash, email, role}`, and calls `supabase.auth.verifyOtp({type:"email", token_hash})` to mint a native Ops session. It then clears the OS token from memory.

So the handoff is a token-exchange model, not a shared session. It is currently blocked at the origin check.

## 3) Exact URL, routes, payload

- Target: `https://ops.trusttai.com/sso` (Ops also refuses to run the flow if the URL contains `access_token|id_token|refresh_token|token_hash|bearer`).
- Ops -> Core: `{ type: "trust-tai-ops:sso-ready" }`.
- Core -> Ops: `{ type: "trust-tai-os:sso", accessToken, organizationId, canonicalProjectId?, targetPath?, returnContext?, issuedAt }`.
- Ops -> its backend: edge function `os-sso-exchange`.
- Ops error vocabulary already includes `os_token_rejected`, `no_ops_membership`, `ops_access_disabled`, `os_not_configured`.

Note: Ops' validator ignores `targetPath`; deep-link landing is not honoured today.

## 4) User-agnostic and org-aware?

Yes on Core's side: nothing is hardcoded to a person. The token is read per click from the live session, and `organizationId` must be a UUID or the launch fails closed. Ops resolves identity and role server-side per user, and enforces Ops membership. Nothing here limits SSO to one user; only the origin allowlist blocks it.

## 5) Security review

Sound, and worth preserving:
- Token never appears in a URL, hash, window name, or storage; posted to an exact origin, never `*`.
- Ready message must come from the Ops origin and from the opened window.
- Fail-closed on missing session or malformed organization id.
- Ops re-verifies the OS token server-side and mints its own short-lived session.

Issues to note:
- Ops' allowlist still contains the two Lovable preview/project origins in production. Preview origins should not be able to hand a session into production Ops.
- Core sends only the access token (roughly 1 hour). That is deliberate, but Ops sessions cannot be renewed from Core; users relaunch after expiry.
- `noopener=no` is required for the handshake and is acceptable given the strict origin checks, but it does mean the Ops tab holds a reference to the Core window.
- `targetPath` is sent and ignored by Ops, so "open the exact Ops project" currently lands on the Ops home.

## 6) What must change, Core vs Ops

Ops (the actual blocker, done in the Ops project's environment, not here):
- Set `VITE_OPS_OS_ORIGINS` to `https://cmd.trusttai.com` and rebuild/redeploy Ops. Remove the two Lovable preview origins from the production value; keep them only in the Ops preview environment.
- Confirm `os-sso-exchange` verifies tokens against Supabase project `okydosoacqdnursmmenf` and that each Core user has an Ops membership row, otherwise users will get `no_ops_membership` instead of the login screen.
- Optional follow-up: honour `targetPath` so project deep links land correctly.

Core (nothing required for SSO to start working):
- Optional: treat `no_ack` as "Ops did not accept this origin" with clearer copy.
- Optional: after Ops honours `targetPath`, no Core change is needed since it is already sent.

## 7) Same Supabase project?

No. They are separate auth tenants.
- Core: `okydosoacqdnursmmenf.supabase.co` (this repo's `.env`).
- Ops primary: `tdqeizrgdasztvbvwanp.supabase.co` (`VITE_OPS_SUPABASE_URL` in the Ops bundle), with Core configured only as a secondary read/verify target (`VITE_OPS_OS_SUPABASE_URL = okydosoacqdnursmmenf`).

Because the tenants differ, a Core session can never be a valid Ops session directly. The exchange-plus-`verifyOtp` design is the correct approach; it only needs the origin allowlist corrected.

## Proposed next step

No code change in Core is needed to unblock SSO. If you want, I can implement the two optional Core improvements (clearer `no_ack` messaging, and a diagnostics line showing the configured Ops origin), but the unblocking action is the Ops environment variable change described above.
