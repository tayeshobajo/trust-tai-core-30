/**
 * Trust Tai OS, sign-in (magic link) email content.
 *
 * The second email surface. Supabase Auth owns delivery of this letter, so the
 * body has to be a Go template it can substitute into: the confirmation URL and
 * the recipient address are left as Supabase placeholders and are never
 * hard-coded here. This module is the canonical source of that template, so the
 * markup pasted into Supabase's Auth email templates is generated, reviewed and
 * tested in the repo rather than typed into a dashboard by hand.
 *
 * Brand. Colours are EMAIL_COLORS from the brand contract, the very same
 * palette the invitation email uses, which is itself the sRGB conversion of the
 * screen tokens. Layout is table based with inline styles only, light only, no
 * web fonts and no tracking, so Gmail, Outlook and Apple Mail all render the
 * same calm letter.
 */

import { BRAND_LOGO, EMAIL_COLORS, EMAIL_LOGO_WIDTH } from "@/brand/brand-contract";
import { CANONICAL_APP_ORIGIN } from "@/lib/auth-origin";

const INK = EMAIL_COLORS.ink;
const PAPER = EMAIL_COLORS.paper;
const ROYAL = EMAIL_COLORS.royal;
const RULE = EMAIL_COLORS.rule;
const MUTED = EMAIL_COLORS.muted;
const SECONDARY = EMAIL_COLORS.secondary;

/** Supabase Auth substitutes these. They must survive into the pasted template. */
export const SUPABASE_CONFIRMATION_URL = "{{ .ConfirmationURL }}";
export const SUPABASE_EMAIL = "{{ .Email }}";

/** The subject Supabase should carry for the magic link template. */
export const MAGIC_LINK_SUBJECT = "Your Trust Tai OS sign-in link";

/** The public lockup an inbox can actually fetch, on the production origin. */
export const MAGIC_LINK_LOGO_URL = `${CANONICAL_APP_ORIGIN}${BRAND_LOGO.publicPath}`;

export interface MagicLinkEmailOptions {
  /** Absolute https URL of the Trust Tai lockup. Falls back to a text lockup. */
  logoUrl?: string | null;
}

function lockup(logoUrl: string | null | undefined): string {
  if (logoUrl && /^https:\/\//i.test(logoUrl)) {
    const h = BRAND_LOGO.emailHeight;
    const w = EMAIL_LOGO_WIDTH;
    return `<img src="${logoUrl}" width="${w}" height="${h}" alt="Trust Tai" style="display:block;border:0;outline:none;text-decoration:none;height:${h}px;width:${w}px" />`;
  }
  return `<span style="font-size:18px;font-weight:600;letter-spacing:.01em;color:${INK}">Trust&nbsp;Tai</span>`;
}

/** The plain text companion, for providers that accept one. */
export function magicLinkEmailText(): string {
  return [
    "Your secure sign-in link",
    "",
    "Use the link below to sign in to Trust Tai OS. For security, this link works once and expires shortly.",
    "",
    SUPABASE_CONFIRMATION_URL,
    "",
    `This email was sent to ${SUPABASE_EMAIL}. Sign in with that same address.`,
    "",
    "If you did not request this email, you can safely ignore it. Nothing changes on your account by receiving it.",
    "",
    "Trust Tai OS · trusttai.com",
  ].join("\n");
}

/** The HTML body to paste into Supabase Auth, Magic Link template. */
export function magicLinkEmailHtml(options: MagicLinkEmailOptions = {}): string {
  const logoUrl = options.logoUrl === undefined ? MAGIC_LINK_LOGO_URL : options.logoUrl;
  const preheader = "Your one time link to sign in to Trust Tai OS.";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="light only" />
<meta name="supported-color-schemes" content="light only" />
<title>${MAGIC_LINK_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:${SECONDARY};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};-webkit-font-smoothing:antialiased">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;font-size:1px;line-height:1px">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SECONDARY};padding:32px 12px">
<tr><td align="center">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;background:${PAPER};border:1px solid ${RULE};border-radius:16px">
    <tr><td style="padding:30px 32px 0 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="left" style="vertical-align:middle">${lockup(logoUrl)}</td>
          <td align="right" style="vertical-align:middle;font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">Trust Tai OS</td>
        </tr>
      </table>
    </td></tr>
    <tr><td style="padding:22px 32px 0 32px"><div style="height:1px;line-height:1px;font-size:0;background:${RULE}">&nbsp;</div></td></tr>
    <tr><td style="padding:0 32px">
      <h1 style="margin:24px 0 0;font-size:24px;line-height:1.25;font-weight:600;color:${INK}">Your secure sign-in link</h1>
      <p style="margin:14px 0 0;font-size:15px;line-height:1.65;color:${INK}">Use the button below to sign in to Trust Tai OS. For security, this link works once and expires shortly.</p>
    </td></tr>
    <tr><td style="padding:24px 32px 4px 32px">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-radius:999px;background:${ROYAL}">
        <a href="${SUPABASE_CONFIRMATION_URL}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:600;line-height:1;color:${PAPER};text-decoration:none;border-radius:999px">Sign in to Trust Tai OS</a>
      </td></tr></table>
    </td></tr>
    <tr><td style="padding:20px 32px 0 32px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${SECONDARY};border-radius:12px">
        <tr><td style="padding:14px 16px;font-size:13px;line-height:1.6;color:${MUTED}">
          This email was sent to <strong style="color:${INK}">${SUPABASE_EMAIL}</strong>. Sign in with that same address, and if another Trust Tai account is open in your browser, sign out of it first.
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">If the button does not work, copy this link into your browser:<br /><a href="${SUPABASE_CONFIRMATION_URL}" style="color:${ROYAL};text-decoration:underline;word-break:break-all">${SUPABASE_CONFIRMATION_URL}</a></p>
    </td></tr>
    <tr><td style="padding:16px 32px 0 32px">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${MUTED}">If you did not request this email, you can safely ignore it. Receiving it changes nothing about your account or your access.</p>
    </td></tr>
    <tr><td style="padding:24px 32px 28px 32px">
      <div style="border-top:1px solid ${RULE};padding-top:16px">
        <p style="margin:0;font-size:12px;line-height:1.6;color:${MUTED}">Trust Tai OS · trusttai.com</p>
        <p style="margin:4px 0 0;font-size:12px;line-height:1.6;color:${MUTED}">Questions? Reply to this email and a person will answer.</p>
      </div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export interface MagicLinkEmailContent {
  subject: string;
  html: string;
  text: string;
}

export function magicLinkEmail(options: MagicLinkEmailOptions = {}): MagicLinkEmailContent {
  return {
    subject: MAGIC_LINK_SUBJECT,
    html: magicLinkEmailHtml(options),
    text: magicLinkEmailText(),
  };
}
