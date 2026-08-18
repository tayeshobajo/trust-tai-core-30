/**
 * Trust Tai OS, invitation email transport (server only).
 *
 * Delivery is deliberately separate from persistence: an invitation row is the
 * truth, an email is only a courtesy notification. If the transport is not
 * configured, or the provider refuses, the caller is told plainly and the
 * invitation still stands.
 *
 * Nothing here grants access. The email carries a sign-in link only; the
 * person still has to authenticate and still has to hold a membership row.
 *
 * This module routes through the Lovable Resend connector gateway rather than
 * calling Resend directly, because the project's Resend connection is managed
 * as a workspace connector. The gateway expects:
 *   Authorization: Bearer ${LOVABLE_API_KEY}
 *   X-Connection-Api-Key: ${RESEND_API_KEY}
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/resend/emails";

/** Visible From address. Override with INVITE_EMAIL_FROM for testing. */
const DEFAULT_FROM = "Trust Tai OS <invites@trusttai.com>";

/** Resend's sandbox sender. Only delivers to the Resend account owner. */
const RESEND_SANDBOX_FROM = "Trust Tai OS <onboarding@resend.dev>";

export interface InviteEmailInput {
  to: string;
  organizationName: string;
  roleLabel: string;
  invitedByName: string;
  /** Absolute sign-in URL on this deployment. */
  signInUrl: string;
  expiresAt: string | null;
}

export interface InviteEmailResult {
  delivered: boolean;
  because: string;
  providerId?: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function expiryLine(expiresAt: string | null): string {
  if (!expiresAt) return "";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return "";
  return `This invitation expires on ${date.toLocaleDateString("en-US", { dateStyle: "long" })}.`;
}

export function inviteEmailBody(input: InviteEmailInput): { subject: string; html: string; text: string } {
  const org = escapeHtml(input.organizationName);
  const by = escapeHtml(input.invitedByName);
  const role = escapeHtml(input.roleLabel);
  const url = escapeHtml(input.signInUrl);
  const expiry = expiryLine(input.expiresAt);

  const subject = `${input.invitedByName} invited you to ${input.organizationName} on Trust Tai OS`;

  const text = [
    `${input.invitedByName} invited you to join ${input.organizationName} on Trust Tai OS as ${input.roleLabel}.`,
    "",
    `Sign in with this address to accept: ${input.signInUrl}`,
    "",
    expiry,
    "",
    "If you were not expecting this, you can ignore it. Nothing is shared with you until you sign in.",
  ]
    .filter((line) => line !== undefined)
    .join("\n");

  const html = `<!doctype html><html><body style="margin:0;background:#f4f7fb;padding:32px 0;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16233c">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:92%;background:#ffffff;border:1px solid #dbe6f5;border-radius:16px;padding:32px">
      <tr><td>
        <p style="margin:0 0 6px;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#5b6b88">Trust Tai OS</p>
        <h1 style="margin:0 0 16px;font-size:22px;font-weight:600;color:#16233c">You have been invited to ${org}</h1>
        <p style="margin:0 0 12px;font-size:15px;line-height:1.6">${by} invited you to join <strong>${org}</strong> as <strong>${role}</strong>.</p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6">Sign in with this email address to accept the invitation.</p>
        <p style="margin:0 0 24px"><a href="${url}" style="display:inline-block;background:#1d4ed8;color:#ffffff;text-decoration:none;padding:12px 22px;border-radius:10px;font-size:15px">Open Trust Tai OS</a></p>
        ${expiry ? `<p style="margin:0 0 12px;font-size:13px;color:#5b6b88">${escapeHtml(expiry)}</p>` : ""}
        <p style="margin:0;font-size:13px;color:#5b6b88">If you were not expecting this, you can ignore it. Nothing is shared with you until you sign in.</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;

  return { subject, html, text };
}

interface ResendError {
  statusCode?: number;
  message?: string;
}

function isDomainUnauthorized(error: ResendError): boolean {
  if (error.statusCode !== 403) return false;
  const message = (error.message ?? "").toLowerCase();
  return message.includes("not authorized to send") || message.includes("domain");
}

async function sendViaGateway(
  from: string,
  input: InviteEmailInput,
): Promise<InviteEmailResult> {
  const lovableKey = process.env["LOVABLE_API_KEY"];
  const resendKey = process.env["RESEND_API_KEY"];
  if (!lovableKey || !resendKey) {
    return {
      delivered: false,
      because: "Email delivery is not configured yet, so the invitation was saved but not emailed.",
    };
  }

  const { subject, html, text } = inviteEmailBody(input);

  try {
    const response = await fetch(GATEWAY_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "X-Connection-Api-Key": resendKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [input.to], subject, html, text }),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as ResendError;
      const status = detail.statusCode ?? response.status;
      const message = detail.message ?? "";

      if (isDomainUnauthorized(detail)) {
        return {
          delivered: false,
          because: `The sender domain is not verified in your Resend account (${message}). Verify the domain in Resend, or set INVITE_EMAIL_FROM to "${RESEND_SANDBOX_FROM}" for owner-only tests.`,
        };
      }

      return {
        delivered: false,
        because: `The email provider refused the message (${status}). The invitation still stands.${
          message ? ` ${message.slice(0, 200)}` : ""
        }`,
      };
    }

    const body = (await response.json().catch(() => ({}))) as { id?: string };
    return {
      delivered: true,
      because: `Invitation emailed to ${input.to}.`,
      ...(body.id ? { providerId: body.id } : {}),
    };
  } catch {
    return {
      delivered: false,
      because: "The email provider could not be reached. The invitation still stands.",
    };
  }
}

export async function sendInviteEmail(input: InviteEmailInput): Promise<InviteEmailResult> {
  const configuredFrom = process.env["INVITE_EMAIL_FROM"] ?? DEFAULT_FROM;

  // If the user explicitly opts into Resend's sandbox sender, use it directly.
  // Otherwise try the branded from address first.
  if (configuredFrom.includes("onboarding@resend.dev")) {
    return sendViaGateway(configuredFrom, input);
  }

  const result = await sendViaGateway(configuredFrom, input);
  if (result.delivered) return result;

  // If the branded domain is not authorized, do not silently fall back to the
  // sandbox sender for arbitrary recipients: that sender only reaches the Resend
  // account owner. Surface the real reason so the admin can verify the domain.
  return result;
}
