/**
 * The browser side of the manual LinkedIn track.
 *
 * There is no LinkedIn integration and no automation: the member sends from
 * their own logged-in LinkedIn account, and this asks our server to RECORD
 * that it happened. Every call carries the signed-in member's Supabase token;
 * the server resolves membership and writes under that same token.
 */

import { supabase } from "@/integrations/trust-tai/supabase";

const MARK_SENT_URL = "/api/public/comms/linkedin/mark-sent";

export interface ManualLinkedinOutcome {
  draftId: string;
  state: "sent" | "sending" | "failed";
  /** True when a repeated click was answered from the record, not re-written. */
  replayed?: boolean;
  providerMessageId?: string;
  error?: string;
}

/**
 * Record one draft as sent on LinkedIn by hand. Idempotent per draft: a
 * double click or a retry replays the recorded outcome instead of writing a
 * second record.
 */
export async function markLinkedinSent(
  organizationId: string,
  draftId: string,
): Promise<ManualLinkedinOutcome> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Your session has expired. Sign in again.");

  const response = await fetch(MARK_SENT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ organizationId, draftId }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      typeof payload["error"] === "string" ? payload["error"] : "That record failed.",
    );
  }
  return payload as unknown as ManualLinkedinOutcome;
}
