/**
 * The browser side of the Gmail track.
 *
 * The client never sees a Google credential. It asks our own server for a
 * consent URL, hands back the code Google returned, and asks for a read pass.
 * Every call carries the signed-in member's Supabase token.
 *
 * A workspace may connect several Gmail mailboxes. Mailbox-scoped actions
 * (sync, candidates, disconnect, send) name their mailbox with
 * `integrationId`; with exactly one connected mailbox it may be omitted and
 * the server resolves it.
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
}): Promise<{ accountEmail: string; canSend?: boolean }> {
  return post<{ accountEmail: string; canSend?: boolean }>(CONNECT_URL, {
    action: "exchange",
    ...input,
  });
}

/** Disconnect ONE mailbox. The others stay connected. */
export async function gmailDisconnect(
  organizationId: string,
  integrationId: string,
): Promise<void> {
  await post(CONNECT_URL, { action: "disconnect", organizationId, integrationId });
}

export interface GmailSyncResult {
  /** The connection row this pass ran against — the mailbox's identity. */
  integrationId?: string;
  accountEmail?: string;
  messagesRead: number;
  messagesStored: number;
  relationshipsTouched: number;
  skippedUnknownPeople: number;
  peopleAdded?: number;
  /** Distinct labeled correspondents not in Comms yet. */
  pendingPeople?: number;
  /** Inbound messages that entered the suite event stream this pass. */
  eventsEmitted?: number;
  /** Sent drafts the mailbox proved this pass. */
  draftsVerified?: number;
  lastSyncAt: string;
}

/**
 * One bounded labeled pass over ONE mailbox, run as the signed-in member.
 * `backfillDays` sets how far back the pass may look (clamped to 1–90,
 * matching the server). `integrationId` names the mailbox; with exactly one
 * connected it may be omitted.
 */
export async function gmailSync(
  organizationId: string,
  backfillDays?: number,
  integrationId?: string,
): Promise<GmailSyncResult> {
  return post<GmailSyncResult>(SYNC_URL, {
    organizationId,
    ...(integrationId ? { integrationId } : {}),
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

export interface MailboxCandidatesResult {
  /** The mailbox these candidates were read from. */
  integrationId: string;
  accountEmail?: string;
  candidates: MailboxCandidate[];
  coverage?: MailboxCoverage;
}

/**
 * People ONE mailbox corresponds with, offered as import candidates. Reads
 * only; each mailbox is gated on its own Trust Tai/Comms label. The window
 * is bounded (at most 60 labeled messages, up to 90 days back) but every
 * correspondent discovered inside it is returned — the UI pages, filters,
 * and searches the full discovered set, so counts are always truthful.
 */
export async function gmailCandidates(
  organizationId: string,
  integrationId?: string,
): Promise<MailboxCandidatesResult> {
  return post<MailboxCandidatesResult>("/api/public/comms/gmail/candidates", {
    organizationId,
    ...(integrationId ? { integrationId } : {}),
  });
}

/* ------------------------------------------------------------------ send */

const SEND_URL = "/api/public/comms/gmail/send";
const ATTACHMENT_URL = "/api/public/comms/gmail/attachment";

/** What ONE connected mailbox may do. */
export interface GmailMailboxCapability {
  integrationId: string;
  accountEmail?: string;
  connected: boolean;
  canSend: boolean;
  requiredScope?: string;
}

export interface GmailSendCapability {
  connected: boolean;
  /** True when at least one connected mailbox holds the send grant. */
  canSend: boolean;
  accountEmail?: string;
  requiredScope?: string;
  /** Every connected Gmail account, one capability each. */
  mailboxes: GmailMailboxCapability[];
}

/** What the connected mailboxes may do. Drives the composer's Send affordance. */
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
 * a second message. Replies always leave from the mailbox that owns the
 * conversation; `integrationId` is the sender choice for a new conversation.
 */
export async function gmailSendDraft(
  organizationId: string,
  draftId: string,
  threadTarget?: { mode: "reply"; providerThreadId: string } | { mode: "new" },
  integrationId?: string,
): Promise<GmailSendOutcome> {
  const response = await fetch(SEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${await token()}`,
    },
    body: JSON.stringify({
      organizationId,
      draftId,
      ...(threadTarget ? { threadTarget } : {}),
      ...(integrationId ? { integrationId } : {}),
    }),
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
 * Fetch one inline MIME image for in-place rendering. Same authenticated
 * proxy as attachment downloads — the server proves the message and the
 * resource belong together and to the caller's workspace, and only stored
 * metadata may declare a resource inline. Returns an object URL; the caller
 * revokes it. No Google credential or raw Gmail URL ever reaches the
 * browser.
 */
export async function gmailFetchInlineImage(input: {
  organizationId: string;
  messageId: string;
  attachmentId: string;
}): Promise<string> {
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
      inline: true,
    }),
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    throw new Error(
      typeof payload["error"] === "string" ? payload["error"] : "That image could not be loaded.",
    );
  }
  return URL.createObjectURL(await response.blob());
}

/**
 * Open one incoming attachment. Bytes come from the mailbox that observed the
 * message, on demand, proxied by our server under the member's own access;
 * nothing is stored in Trust Tai.
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
