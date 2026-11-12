# Hiring release configuration — read-only findings (no action proposed)

## Findings (Lovable sandbox only)
- Custom-domain publishing target: https://cmd.trusttai.com (primary). Published fallback: https://trusttai-os-foundation.lovable.app.
- Repository main HEAD: 84a7e3370362591f5a5c73ec460ea0c56a3c4f3c (local `main` ref; remote GitHub HEAD not independently verified).
- SUPABASE_SERVICE_ROLE_KEY: absent. SUPABASE_SECRET_KEY: absent. (Existing store uses TRUST_TAI_SUPABASE_SERVICE_KEY, present earlier.)
- RESEND_API_KEY: present. LOVABLE_API_KEY: present.
- Sender: RESEND_FROM_EMAIL absent; no other sender variable configured.

## Provider setup (src/lib/comms-resend-send.server.ts)
- Calls https://api.resend.com/emails directly with RESEND_API_KEY (not via the Lovable connector gateway).
- `resendCredentials()` returns null unless BOTH RESEND_API_KEY and RESEND_FROM_EMAIL are set, so sending is currently disabled (fails closed).

## Answers
- Can the server reuse existing credentials without exposing them? Yes: a Hiring outbox worker can call `resendCredentials()` server-side, and values stay in Project Secrets. It would not send, though, until RESEND_FROM_EMAIL is set.
- Sender identity/domain: not verified. No sender is configured, and no read-only Resend domain check was run (that would need an outside call).

## Remaining blockers (not done)
- RESEND_FROM_EMAIL needs a sender on a domain verified in Resend.
- Live applicant sends are still unapproved; controlled QA only.
