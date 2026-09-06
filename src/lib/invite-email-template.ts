/**
 * Trust Tai OS, invitation email content.
 *
 * This module is deliberately client safe: the Settings invite panel renders
 * the exact subject and body an admin is about to send, and the server
 * transport sends the very same output. One template, no drift.
 *
 * Brand. Colours come from EMAIL_COLORS in the brand contract, which is the
 * sRGB conversion of the very tokens src/styles.css uses on screen; a test
 * reconverts them, so the letter in an inbox cannot drift from the product.
 * They are written as literal hex here only because email clients understand
 * neither oklch, CSS variables nor color-mix().
 *
 * Layout is table based with inline styles only, so Gmail, Outlook and Apple
 * Mail all render the same calm letter. No dark-theme dependency, no tracking,
 * no web fonts: system fonts degrade gracefully everywhere.
 */

import { BRAND_LOGO, EMAIL_COLORS, EMAIL_LOGO_WIDTH } from "@/brand/brand-contract";

const INK = EMAIL_COLORS.ink;
const PAPER = EMAIL_COLORS.paper;
const ROYAL = EMAIL_COLORS.royal;
const RULE = EMAIL_COLORS.rule;
const MUTED = EMAIL_COLORS.muted;
const SECONDARY = EMAIL_COLORS.secondary;


export interface InviteEmailInput {
  to: string;
  organizationName: string;
  roleLabel: string;
  invitedByName: string;
  /** Absolute sign-in URL on this deployment, already carrying invite context. */
  signInUrl: string;
  expiresAt: string | null;
  /**
   * Absolute, publicly reachable URL of the Trust Tai lockup. Optional: when
   * it is absent the header falls back to a text lockup rather than a broken
   * image, because a bundled asset path is not reachable from an inbox.
   */
  logoUrl?: string | null;
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

/**
 * The header lockup: the official Trust Tai mark when we have a public URL,
 * the wordmark when we do not. Its size is derived from the lockup's natural
 * geometry in the brand contract, so the mark can never be squashed, and the
 * image is served at twice the rendered height for retina inboxes.
 */
function headerLockup(logoUrl: string | null | undefined): string {
  if (logoUrl && /^https:\/\//i.test(logoUrl)) {
    const h = BRAND_LOGO.emailHeight;
    const w = EMAIL_LOGO_WIDTH;
    return `<img src="${escapeHtml(logoUrl)}" width="${w}" height="${h}" alt="Trust Tai" style="display:block;border:0;outline:none;text-decoration:none;height:${h}px;width:${w}px" />`;
  }
  return `<span style="font-size:18px;font-weight:600;letter-spacing:.01em;color:${INK}">Trust&nbsp;Tai</span>`;
}


export function inviteEmailBody(input: InviteEmailInput): InviteEmailContent {
  const org = escapeHtml(input.organizationName);
  const by = escapeHtml(input.invitedByName);
  const role = escapeHtml(input.roleLabel);
  const url = escapeHtml(input.signInUrl);
  const to = escapeHtml(input.to);
  const expiry = expiryLine(input.expiresAt);

  const subject = `${input.invitedByName} invited you to ${input.organizationName} on Trust Tai OS`;

  const preheader = `${input.invitedByName} invited you to ${input.organizationName} as ${input.roleLabel}. Use ${input.to} to accept.`;

  const text = [
    `${input.invitedByName} invited you to join ${input.organizationName} on Trust Tai OS as ${input.roleLabel}.`,
    "",
    "Trust Tai OS is the workspace where your clients, projects, communication and decisions live in one place.",
    "",
    `Accepting gives you ${input.roleLabel} access to ${input.organizationName}. Nothing is shared with you until you sign in.`,
    "",
    `Open Trust Tai OS: ${input.signInUrl}`,
    "",
    `Use this email address to sign in: ${input.to}. If you are already signed in with a different account, sign out first.`,
    "",
    expiry,
    "",
    "If you were not expecting this, you can ignore it. The invitation grants nothing on its own.",
    "",
    "Trust Tai OS · trusttai.com",
  ]
    .filter((line) => line !== "")
    .join("\n");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${SECONDARY};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SECONDARY};padding:32px 12px">
<tr><td align="center">
  <table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0" style="width:560px;max-width:100%;background:${PAPER};border:1px solid ${RULE};border-radius:16px">
    <tr><td style="padding:28px 32px 0 32px">
      ${headerLockup(input.logoUrl)}
      <p style="margin:18px 0 0;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Trust Tai OS</p>
    </td></tr>
    <tr><td style="padding:0 32px">
      <h1 style="margin:10px 0 0;font-size:24px;line-height:1.25;font-weight:600;color:${INK}">${by} invited you to ${org}.</h1>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${INK}">Trust Tai OS is the workspace where clients, projects, communication and decisions sit together, so the next move is always clear.</p>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${INK}">You have been invited as <strong style="color:${INK}">${role}</strong>. Accepting creates your place in ${org} and opens the rooms your role carries. Nothing is shared with you until you sign in.</p>
    </td></tr>
    <tr><td style="padding:24px 32px 4px 32px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background:${ROYAL}">
        <a href="${url}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;line-height:1;color:${PAPER};text-decoration:none;border-radius:999px">Open Trust Tai OS</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:20px 32px 0 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SECONDARY};border-radius:12px">
        <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:${MUTED}">
          Sign in with <strong style="color:${INK}">${to}</strong>. If a different Trust Tai account is already open in your browser, sign out of it first, then use this link again.
        </td></tr>
      </table>
    </td></tr>
    ${
      expiry
        ? `<tr><td style="padding:16px 32px 0 32px"><p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(expiry)}</p></td></tr>`
        : ""
    }
    <tr><td style="padding:16px 32px 0 32px">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">If you were not expecting this, you can ignore it. An invitation grants nothing on its own, and access still depends on signing in as the invited address.</p>
    </td></tr>
    <tr><td style="padding:24px 32px 28px 32px">
      <div style="border-top:1px solid ${RULE};padding-top:16px">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">Trust Tai OS · Sent by ${by} at ${org}</p>
        <p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:${MUTED}">Questions? Reply to this email and a person will answer.</p>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
