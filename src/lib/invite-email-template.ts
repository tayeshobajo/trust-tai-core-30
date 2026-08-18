/**
 * Trust Tai OS, invitation email content.
 *
 * This module is deliberately client safe: the Settings invite panel renders
 * the exact subject and body an admin is about to send, and the server
 * transport sends the very same output. One template, no drift.
 */

export interface InviteEmailInput {
  to: string;
  organizationName: string;
  roleLabel: string;
  invitedByName: string;
  /** Absolute sign-in URL on this deployment. */
  signInUrl: string;
  expiresAt: string | null;
}

export interface InviteEmailContent {
  subject: string;
  html: string;
  text: string;
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

export function inviteEmailBody(input: InviteEmailInput): InviteEmailContent {
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
