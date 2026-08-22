/**
 * The browser side of the Gmail track.
 *
 * The client never sees a Google credential. It asks our own server for a
 * consent URL, hands back the code Google returned, and asks for a read pass.
 * Every call carries the signed-in member's Supabase token.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import { clampBackfillDays } from "@/data/comms-onboarding";
import type { MailboxCoverage } from "@/domain/comms-integrations";

export type { MailboxCoverage };

const CONNECT_URL = "/api/public/comms/gmail/connect";
const SYNC_URL = "/api/public/comms/gmail/sync";

async function token(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your session has expired. Sign in again.");
  return value;
}

async function post<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify(body),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "That call failed.");
  }
  return payload as T;
}

/** Whether the server holds Google credentials, and the exact callback used. */
export async function gmailStatus(): Promise<{ configured: boolean; redirectUri: string }> {
  const response = await fetch(CONNECT_URL);
  if (!response.ok) return { configured: false, redirectUri: "" };
  return (await response.json()) as { configured: boolean; redirectUri: string };
}

export async function gmailAuthorizeUrl(organizationId: string): Promise<string> {
  const result = await post<{ url: string }>(CONNECT_URL, {
    action: "authorize-url",
    organizationId,
  });
  return result.url;
}

export async function gmailExchange(input: {
  organizationId: string;
  code: string;
  state: string;
}): Promise<{ accountEmail: string }> {
  return post<{ accountEmail: string }>(CONNECT_URL, { action: "exchange", ...input });
}

export async function gmailDisconnect(organizationId: string): Promise<void> {
  await post(CONNECT_URL, { action: "disconnect", organizationId });
}

export interface GmailSyncResult {
  accountEmail?: string;
  messagesRead: number;
  messagesStored: number;
  relationshipsTouched: number;
  skippedUnknownPeople: number;
  /** Distinct labeled correspondents not in Comms yet. */
  pendingPeople?: number;
  /** Inbound messages that entered the suite event stream this pass. */
  eventsEmitted?: number;
  /** Sent drafts the mailbox proved this pass. */
  draftsVerified?: number;
  lastSyncAt: string;
}

/**
 * One bounded labeled pass, run as the signed-in member. `backfillDays` sets
 * how far back the pass may look (clamped to 1–90, matching the server).
 */
export async function gmailSync(
  organizationId: string,
  backfillDays?: number,
): Promise<GmailSyncResult> {
  return post<GmailSyncResult>(SYNC_URL, {
    organizationId,
    ...(backfillDays === undefined ? {} : { backfillDays: clampBackfillDays(backfillDays) }),
  });
}

export interface MailboxCandidate {
  email: string;
  name?: string;
  messageCount: number;
  lastMessageAt: string;
  lastSubject?: string;
  alreadyTracked: boolean;
}

/** People you correspond with, offered as import candidates. Reads only. */
export async function gmailCandidates(
  organizationId: string,
): Promise<{ accountEmail?: string; candidates: MailboxCandidate[]; coverage?: MailboxCoverage }> {
  return post<{ accountEmail?: string; candidates: MailboxCandidate[]; coverage?: MailboxCoverage }>(
    "/api/public/comms/gmail/candidates",
    { organizationId },
  );
}
