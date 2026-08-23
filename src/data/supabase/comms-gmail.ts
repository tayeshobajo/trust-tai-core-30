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

/* ------------------------------------------------------------------ send */

const SEND_URL = "/api/public/comms/gmail/send";
const ATTACHMENT_URL = "/api/public/comms/gmail/attachment";

export interface GmailSendCapability {
  connected: boolean;
  /** False while the stored grant is read-only; the composer stays calm. */
  canSend: boolean;
  accountEmail?: string;
  requiredScope?: string;
}

/** What the connected mailbox may do. Drives the composer's Send affordance. */
export async function gmailSendStatus(organizationId: string): Promise<GmailSendCapability> {
  const response = await fetch(`${SEND_URL}?organizationId=${encodeURIComponent(organizationId)}`, {
    headers: { Authorization: `Bearer ${await token()}` },
  });
  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "That check failed.");
  }
  return payload as unknown as GmailSendCapability;
}

export interface GmailSendOutcome {
  draftId: string;
  state: "sent" | "sending" | "failed" | "blocked";
  replayed?: boolean;
  providerMessageId?: string;
  providerThreadId?: string;
  error?: string;
  requiredScope?: string;
}

/**
 * Send one draft through Gmail. Human-triggered only; idempotent per draft —
 * a double click or a retry replays the recorded outcome instead of sending
 * a second message.
 */
export async function gmailSendDraft(
  organizationId: string,
  draftId: string,
  threadTarget?: { mode: "reply"; providerThreadId: string } | { mode: "new" },
): Promise<GmailSendOutcome> {
  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({ organizationId, draftId, ...(threadTarget ? { threadTarget } : {}) }),
  });
  const payload = (await response.json()) as Record<string, unknown>;
  // The permission checkpoint arrives as 403 with a structured outcome.
  if (!response.ok && response.status !== 403) {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "That send failed.");
  }
  if (!response.ok && typeof payload["state"] !== "string") {
    throw new Error(typeof payload["error"] === "string" ? payload["error"] : "That send failed.");
  }
  return payload as unknown as GmailSendOutcome;
}

/**
 * Open one incoming attachment. Bytes come from Gmail on demand, proxied by
 * our server under the member's own access; nothing is stored in Trust Tai.
 */
export async function gmailDownloadAttachment(input: {
  organizationId: string;
  messageId: string;
  attachmentId: string;
  filename: string;
}): Promise<void> {
  const response = await fetch(ATTACHMENT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({
      organizationId: input.organizationId,
      messageId: input.messageId,
      attachmentId: input.attachmentId,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      typeof payload["error"] === "string" ? payload["error"] : "That file could not be opened.",
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = input.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
