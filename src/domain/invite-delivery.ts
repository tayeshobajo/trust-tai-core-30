/**
 * Trust Tai OS, invitation delivery truth.
 *
 * An invitation row is the fact. An email is only a courtesy notification.
 * These helpers read what actually happened, from the durable invitation
 * activity stream, and say it plainly: the invitation is prepared, the email
 * reached the provider, or the provider refused for a reason a human can act
 * on. Nothing here sends, retries, or invents a state; there is no provider
 * status API in play, only evidence we already recorded.
 */

/** Every truthful delivery state an invitation can be in. No others exist. */
export type InviteDeliveryState =
  /** Saved and valid. No email attempt has been recorded yet. */
  | "prepared"
  /** The provider accepted the message for delivery. */
  | "delivered"
  /** The provider refused because the sender domain is not authorized. */
  | "sender_unverified"
  /** No email transport is configured, so nothing was attempted. */
  | "not_configured"
  /** The provider refused for some other reason. */
  | "refused";

/** Pill tones already in the design system. Kept as literals so this stays pure. */
export type InviteDeliveryTone = "neutral" | "good" | "caution" | "risk";

export const INVITE_DELIVERY_LABEL: Record<InviteDeliveryState, string> = {
  prepared: "Prepared",
  delivered: "Emailed",
  sender_unverified: "Email blocked",
  not_configured: "Email off",
  refused: "Email refused",
};

export const INVITE_DELIVERY_TONE: Record<InviteDeliveryState, InviteDeliveryTone> = {
  prepared: "neutral",
  delivered: "good",
  sender_unverified: "caution",
  not_configured: "neutral",
  refused: "risk",
};

/** One plain sentence about what is true right now. */
export const INVITE_DELIVERY_MEANING: Record<InviteDeliveryState, string> = {
  prepared: "The invitation is saved and valid. No email has gone out for it yet.",
  delivered: "The email provider accepted this invitation email.",
  sender_unverified:
    "The invitation is saved and the wiring is healthy. The email provider would not send it because the sending address has not been verified yet.",
  not_configured: "The invitation is saved. Email sending is not switched on for this workspace.",
  refused: "The invitation is saved. The email provider would not send the message.",
};

/** The one thing a person can do next, when there is one. */
export const INVITE_DELIVERY_ACTION: Partial<Record<InviteDeliveryState, string>> = {
  sender_unverified:
    "Verify the sending domain with the email provider, then try sending this invitation again.",
  refused: "Check the reason below, then try sending this invitation again.",
};

/**
 * Read a refusal sentence and decide which kind of refusal it is. The sentences
 * come from our own transport module, so this matches on the wording we write,
 * with a broader safety net for provider phrasing.
 */
export function classifyDeliveryFailure(because: string | null | undefined): InviteDeliveryState {
  const text = (because ?? "").toLowerCase();
  if (!text) return "refused";
  if (text.includes("not configured")) return "not_configured";
  if (
    text.includes("sender domain is not verified") ||
    text.includes("not authorized to send") ||
    (text.includes("domain") && (text.includes("verify") || text.includes("verified")))
  ) {
    return "sender_unverified";
  }
  return "refused";
}

export interface DeliveryOutcomeLike {
  delivered: boolean;
  because?: string | null;
}

/** The state implied by a single delivery outcome. No outcome means prepared. */
export function deliveryStateOf(
  outcome: DeliveryOutcomeLike | null | undefined,
): InviteDeliveryState {
  if (!outcome) return "prepared";
  if (outcome.delivered) return "delivered";
  return classifyDeliveryFailure(outcome.because ?? null);
}

export interface DeliveryAttemptLike {
  /** Which invitation the attempt belongs to. Attempts without one are ignored. */
  invitationId: string | null;
  at: string;
  delivered: boolean | null;
  because: string | null;
}

export interface InviteDelivery {
  state: InviteDeliveryState;
  because: string | null;
  at: string;
}

/**
 * The most recent recorded email attempt per invitation, taken from the durable
 * activity stream. Entries without an invitation id, or without a recorded
 * delivery outcome, are not evidence and are skipped.
 */
export function latestDeliveryByInvitation(
  entries: readonly DeliveryAttemptLike[],
): Record<string, InviteDelivery> {
  const latest: Record<string, InviteDelivery> = {};
  for (const entry of entries) {
    const id = entry.invitationId;
    if (!id || typeof entry.delivered !== "boolean") continue;
    const existing = latest[id];
    if (existing && existing.at >= entry.at) continue;
    latest[id] = {
      state: deliveryStateOf({ delivered: entry.delivered, because: entry.because }),
      because: entry.because,
      at: entry.at,
    };
  }
  return latest;
}
