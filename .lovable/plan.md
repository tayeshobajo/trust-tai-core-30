# Real invitation email delivery via Resend

## Goal
Make Settings invitation emails actually arrive in recipients' inboxes, without reopening the Settings access architecture. Keep Resend as the provider, but use the already-linked Resend connection through the supported Lovable connector gateway.

## Current state
- Invitation persistence, lifecycle, and audit trail are verified and working.
- `src/lib/settings-invite-email.server.ts` calls `https://api.resend.com/emails` directly with `process.env["RESEND_API_KEY"]`.
- `src/routes/api/public/settings.invite-email.ts` verifies the caller is an owner/admin, then calls the send helper.
- The UI calls `deliverInvitationEmail` after create and resend, but no external email is delivered.
- The workspace already has a linked Resend connection (`tayeshobajo@gmail.com`) with gateway access enabled, but the code does not use it.
- No Lovable-managed email domain is configured; this is fine because we are keeping Resend.

## Plan

1. **Diagnose the immediate failure**
   - Confirm whether `RESEND_API_KEY` is reaching the deployed server route, or whether the direct `api.resend.com` call is failing silently.
   - Verify whether `trusttai.com` / `invites@trusttai.com` is a verified sending domain inside the linked Resend account.
   - Record the finding; if the domain is not verified, that is the first fix before any code change matters.

2. **Migrate the send helper to the Resend connector gateway**
   - Replace the direct `fetch` to `https://api.resend.com/emails` with a call to `https://connector-gateway.lovable.dev/resend/emails`.
   - Send `Authorization: Bearer ${LOVABLE_API_KEY}` and `X-Connection-Api-Key: ${RESEND_API_KEY}` headers.
   - Keep the existing HTML/text template and `InviteEmailResult` shape so the API route and UI need no contract changes.
   - Preserve graceful degradation: if keys are missing, return `delivered: false` with a clear reason, never throw.

3. **Make the from address safe and configurable**
   - Keep `invites@trusttai.com` as the default `FROM` address via `INVITE_EMAIL_FROM` env override.
   - If Resend rejects because the domain is unverified, surface the exact provider message in the UI and fall back to `onboarding@resend.dev` only for owner-directed verification tests, with a visible warning that it only reaches the Resend account owner.

4. **Surface delivery status in Settings > People**
   - Show the outcome of the last email attempt per pending invitation (delivered, bounced, provider refused, not configured).
   - Include the provider's refusal reason in the invitation audit trail entry when `delivered: false`.
   - Keep the existing audit event names (`user.invite_emailed`, etc.).

5. **End-to-end verification**
   - Send a real invitation from the Settings UI to a test address.
   - Confirm the Resend/gateway response is 200 and a provider ID is returned.
   - Confirm the recipient receives the email and the sign-in link points to the correct origin.
   - Update any existing unit/server tests that mock the old direct Resend endpoint.

## Out of scope
- Switching to Lovable-managed email (rejected by user).
- Changing invitation persistence, RLS, access control, or the audit schema.
- Adding marketing/bulk email capabilities.

## Success criteria
- Creating a new invitation from Settings > People sends a real email to the recipient.
- Resending a pending invitation sends a real email.
- Failed deliveries show a clear, actionable reason in the UI instead of silently failing.
- The audit trail accurately reflects created, emailed, resent, and cancelled events.