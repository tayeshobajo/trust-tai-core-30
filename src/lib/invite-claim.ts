/**
 * Claiming an invitation from the browser.
 *
 * One helper, used by every surface where a signed-in person may be holding a
 * pending invitation: the sign-in screen and the closed-workspace boundary.
 *
 * The important property is that a claim is driven by WHO IS SIGNED IN, not by
 * what the link happened to carry. An invitation id is passed when the email
 * link supplies one, but its absence is not a dead end: the endpoint then
 * looks for a pending invitation issued to the session's own verified address.
 * That is what makes an older email, a forwarded link, a stripped query string
 * or a plain visit to the app all reach the same honest outcome.
 *
 * Nothing here grants anything. The server verifies the bearer token against
 * Supabase Auth and re-decides with the shared domain rule; this module only
 * carries the request and reports the outcome.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

export interface ClaimResult {
  ok: boolean;
  /** One of the shared InviteAcceptanceOutcome values, or "unknown". */
  outcome: string;
  /** One plain sentence for a human. */
  because: string;
}

const NO_SESSION: ClaimResult = {
  ok: false,
  outcome: "no_session",
  because: "Sign in as the invited address to accept.",
};

const UNREACHABLE: ClaimResult = {
  ok: false,
  outcome: "unknown",
  because: "We could not reach Trust Tai to accept your invitation. Try again in a moment.",
};

/**
 * Attempt the claim once.
 * `invitationId` is optional: without it the server resolves the pending
 * invitation belonging to the signed-in address.
 */
export async function claimInvitation(invitationId?: string | null): Promise<ClaimResult> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return NO_SESSION;

  const response = await fetch("/api/public/settings/invite-accept", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(invitationId ? { invitationId } : {}),
  }).catch(() => null);
  if (!response) return UNREACHABLE;

  const body = (await response.json().catch(() => null)) as Partial<ClaimResult> | null;
  if (!body) return UNREACHABLE;

  return {
    ok: Boolean(body.ok),
    outcome: body.outcome ?? "unknown",
    because: body.because ?? UNREACHABLE.because,
  };
}

/**
 * True when an outcome means "nothing is wrong, there is simply no invitation
 * waiting for this person". Surfaces use it to stay quiet instead of showing
 * an alarming failure to someone who was never invited.
 */
export function isQuietClaimOutcome(outcome: string): boolean {
  return outcome === "unknown" || outcome === "no_session";
}
