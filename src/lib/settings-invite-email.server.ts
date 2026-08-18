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

import {
  inviteEmailBody,
  type InviteEmailInput,
} from "@/lib/invite-email-template";

export { inviteEmailBody };
export type { InviteEmailInput };

export interface InviteEmailResult {
  delivered: boolean;
  because: string;
  providerId?: string;
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
