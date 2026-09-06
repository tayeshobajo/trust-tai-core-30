/**
 * Trust Tai OS, invitation acceptance truth.
 *
 * One question, answered in one place: may this browser session consume this
 * invitation right now? Nothing here grants anything. It only decides which
 * honest state a person is in, so the sign-in screen and the acceptance
 * endpoint can never disagree about it.
 *
 * The rules are deliberately narrow:
 *  - an invitation is only consumable by the exact address it was issued to
 *  - a session signed in as somebody else is never evaluated as the invitee
 *  - expired, cancelled and already-accepted invitations keep saying so
 */

export type InviteAcceptanceOutcome =
  /** Signed in as the invited address, invitation still pending and in date. */
  | "accept"
  /** Nobody is signed in yet. */
  | "no_session"
  /** Somebody else's session is active in this browser. */
  | "wrong_account"
  /** The invitation is past its expiry date. */
  | "expired"
  /** An admin cancelled it. */
  | "cancelled"
  /** It has already been consumed. */
  | "already_accepted"
  /** No such invitation, or it is no longer readable. */
  | "unknown";

export interface InviteRecord {
  email: string;
  /** pending | accepted | cancelled | expired */
  status: string;
  expiresAt: string | null;
  organizationName?: string | null;
  roleLabel?: string | null;
}

export interface InviteAcceptanceInput {
  invitation: InviteRecord | null;
  /** The email of the currently signed-in account, if any. */
  sessionEmail: string | null;
  /** Injected so tests are not clock dependent. */
  now?: Date;
}

export interface InviteAcceptanceDecision {
  outcome: InviteAcceptanceOutcome;
  /** One plain sentence for a human. */
  because: string;
  /** The address this invitation belongs to, when known. */
  invitedEmail: string | null;
  /** The address currently signed in, when there is one. */
  signedInEmail: string | null;
}

/** Addresses compare case and whitespace insensitively, and never loosely. */
export function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeEmail(a);
  const right = normalizeEmail(b);
  return left !== "" && left === right;
}

function isExpired(expiresAt: string | null, now: Date): boolean {
  if (!expiresAt) return false;
  const at = new Date(expiresAt);
  if (Number.isNaN(at.getTime())) return false;
  return at.getTime() <= now.getTime();
}

export function evaluateInviteAcceptance(input: InviteAcceptanceInput): InviteAcceptanceDecision {
  const now = input.now ?? new Date();
  const signedInEmail = normalizeEmail(input.sessionEmail) || null;
  const invitation = input.invitation;
  const invitedEmail = invitation ? normalizeEmail(invitation.email) || null : null;

  const base = { invitedEmail, signedInEmail };

  if (!invitation) {
    return {
      ...base,
      outcome: "unknown",
      because: "This invitation is no longer available. Ask whoever invited you to send a new one.",
    };
  }

  if (invitation.status === "cancelled") {
    return {
      ...base,
      outcome: "cancelled",
      because: "This invitation was cancelled. Ask whoever invited you to send a new one.",
    };
  }

  if (invitation.status === "accepted") {
    return {
      ...base,
      outcome: "already_accepted",
      because: "This invitation has already been used. Sign in with that address to continue.",
    };
  }

  if (invitation.status !== "pending" || isExpired(invitation.expiresAt, now)) {
    return {
      ...base,
      outcome: "expired",
      because: "This invitation has expired. Ask whoever invited you to send a new one.",
    };
  }

  /* Order matters. A wrong active session is answered before anything is
     evaluated on the invitee's behalf, so no other account is ever measured
     against this invitation. */
  if (signedInEmail && invitedEmail && !sameEmail(signedInEmail, invitedEmail)) {
    return {
      ...base,
      outcome: "wrong_account",
      because: `This invitation is for ${invitedEmail}. You are signed in as ${signedInEmail}.`,
    };
  }

  if (!signedInEmail) {
    return {
      ...base,
      outcome: "no_session",
      because: invitedEmail
        ? `Sign in as ${invitedEmail} to accept this invitation.`
        : "Sign in to accept this invitation.",
    };
  }

  return {
    ...base,
    outcome: "accept",
    because: "This invitation is ready to accept.",
  };
}

/** True only for the one outcome that may create or activate a membership. */
export function mayConsumeInvitation(decision: InviteAcceptanceDecision): boolean {
  return decision.outcome === "accept";
}
