/**
 * Trust Tai OS, Comms external integration contracts.
 *
 * Comms is allowed to read the outside world. It is never allowed to speak for
 * Tai without a person, and it is never allowed to claim something it did not
 * read.
 *
 * Three rules hold across every provider here:
 *  1. Everything a provider returns arrives as observed truth with provenance
 *     and a fetch time. Derived readings are inferred. Only a person decides.
 *  2. Providers are server-side. No vendor key, token, or secret may reach the
 *     browser; the client only ever calls our own routes.
 *  3. A provider that is not connected says so. There is no sample data.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { ThreadState } from "./comms";

/* ------------------------------------------------------------ connections */

export type IntegrationProvider = "gmail";

export const INTEGRATION_PROVIDER_LABEL: Record<IntegrationProvider, string> = {
  gmail: "Gmail",
};

export type IntegrationStatus = "disconnected" | "connected" | "error" | "revoked";

export const INTEGRATION_STATUS_LABEL: Record<IntegrationStatus, string> = {
  disconnected: "Not connected",
  connected: "Connected",
  error: "Needs attention",
  revoked: "Access revoked",
};

/**
 * What a member may see about a connection. Deliberately no token field: the
 * refresh token lives in the private schema, readable only by the server.
 */
export interface IntegrationConnection {
  id: ID;
  organizationId: ID;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  accountEmail?: string;
  scopes: string[];
  /** Opaque provider cursor (Gmail historyId, page token, since date). */
  cursor: Record<string, unknown>;
  lastSyncAt?: ISODateTime;
  lastError?: string;
  connectedBy?: ID;
  updatedAt: ISODateTime;
}

/**
 * Reading stays label-gated on `Trust Tai/Comms` no matter what else is
 * granted: this scope is the entire read surface, and sync never asks for
 * more.
 */
export const GMAIL_READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/**
 * The narrowest permission that lets a person send a draft they approved.
 * Requested on the same consent screen as reading, so the boundary stays
 * explicit: Comms can send only when a human clicks Send. `gmail.modify`
 * is never requested — Comms cannot alter Gmail labels, by construction.
 */
export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";

/** Every Gmail scope a Comms connection may request or persist. */
export const GMAIL_CONNECTION_SCOPES = [...GMAIL_READ_SCOPES, GMAIL_SEND_SCOPE];

/**
 * The scopes to persist from a Google token response. Google reports the
 * actually granted set as a space-delimited `scope` field; we keep only the
 * Gmail scopes Comms understands, so a capability check can trust the row.
 * A missing field falls back to read-only — send stays blocked unless the
 * grant is explicit. Never widened beyond what Google returned.
 */
export function grantedGmailScopes(scopeField: unknown): string[] {
  if (typeof scopeField !== "string" || scopeField.trim().length === 0) {
    return [...GMAIL_READ_SCOPES];
  }
  const granted = new Set(scopeField.split(/\s+/).filter(Boolean));
  return GMAIL_CONNECTION_SCOPES.filter((scope) => granted.has(scope));
}

/* --------------------------------------------------------------- messages */

export type MessageDirection = "inbound" | "outbound";

/**
 * What Comms knows about a file on a message: name, kind, size, and the
 * provider handle that fetches the bytes on demand. Content never lives in
 * this shape — Gmail stays the source of truth for Gmail-native files.
 */
export interface AttachmentMeta {
  filename: string;
  mimeType: string;
  size: number;
  /** Provider-side handle for on-demand download (Gmail attachmentId). */
  attachmentId?: string;
}

/** One message, in Trust Tai's shape rather than any vendor's. */
export interface NormalizedMessage {
  providerMessageId: string;
  providerThreadId: string;
  direction: MessageDirection;
  fromEmail?: string;
  fromName?: string;
  toEmails: string[];
  ccEmails: string[];
  subject?: string;
  snippet?: string;
  /** Stored only when the organization has opted into body retention. */
  bodyText?: string;
  occurredAt: ISODateTime;
  headers?: Record<string, string>;
  /** File metadata only — bytes are fetched from the provider on demand. */
  attachments?: AttachmentMeta[];
}

export interface NormalizedThread {
  providerThreadId: string;
  subject?: string;
  messages: NormalizedMessage[];
}

/**
 * A mailbox message as Comms stored it — the row the relationship timeline
 * reads. Provider ids ride along so the room can target a reply at the right
 * thread and fetch an attachment's bytes on demand; they are identifiers,
 * never credentials.
 */
export interface StoredMailboxMessage {
  id: ID;
  organizationId: ID;
  relationshipId: ID;
  threadId?: ID;
  providerMessageId?: string;
  providerThreadId?: string;
  direction: MessageDirection;
  fromEmail?: string;
  fromName?: string;
  subject?: string;
  snippet?: string;
  occurredAt: ISODateTime;
  attachments?: AttachmentMeta[];
  /** True when Comms itself sent this message through Gmail. */
  sentViaComms?: boolean;
}

/** What one incremental sync pass returns. */
export interface MailChangeSet {
  threads: NormalizedThread[];
  /** Cursor to persist for the next pass. Absent means nothing moved. */
  cursor?: Record<string, unknown>;
}

/**
 * The one shape every mailbox source implements. Nothing else in Comms knows
 * that Gmail exists.
 */
export interface MailProvider {
  id: IntegrationProvider;
  label: string;
  /** Whether credentials are configured on the server right now. */
  available(): Promise<boolean>;
  /** Everything that changed since the stored cursor. */
  listChanges(input: {
    connection: IntegrationConnection;
    cursor: Record<string, unknown>;
    /** First connect: how far back to read, in days. Bounded on purpose. */
    backfillDays?: number;
  }): Promise<MailChangeSet>;
  getThread(input: {
    connection: IntegrationConnection;
    providerThreadId: string;
  }): Promise<NormalizedThread | null>;
}

/* ----------------------------------------------------------------- events */

export type EventSourceKind = "manual" | "ics" | "api" | "public_page";

export const EVENT_SOURCE_LABEL: Record<EventSourceKind, string> = {
  manual: "Added by hand",
  ics: "Calendar feed",
  api: "Event provider",
  public_page: "Public event page",
};

/** An event as a provider offers it. Not yet stored, not yet recommended. */
export interface EventDraft {
  providerEventId?: string;
  name: string;
  startsAt?: ISODateTime;
  endsAt?: ISODateTime;
  city?: string;
  region?: string;
  venue?: string;
  url?: string;
  topics: string[];
  description?: string;
  evidence: EvidenceRef[];
}

export interface EventFetchInput {
  organizationId: ID;
  /** Where we care about. Nashville and Tennessee first. */
  region?: string;
  city?: string;
  since?: ISODateTime;
  until?: ISODateTime;
}

export interface EventProviderInfo {
  id: string;
  label: string;
  description: string;
  kind: EventSourceKind;
  /** Explicitly approved for Trust Tai use (terms allow programmatic access). */
  approved: boolean;
}

export interface EventProvider extends EventProviderInfo {
  available(): Promise<boolean>;
  fetch(input: EventFetchInput): Promise<EventDraft[]>;
}

/** Why an event is worth Tai's time. No reason code, no recommendation. */
export type EventReasonCode =
  | "relationship_attending"
  | "relationship_nearby"
  | "role_relevance"
  | "region_priority"
  | "topic_match";

export const EVENT_REASON_LABEL: Record<EventReasonCode, string> = {
  relationship_attending: "Someone we know is involved",
  relationship_nearby: "People we know are in this city",
  role_relevance: "The room holds people who decide",
  region_priority: "In our home region",
  topic_match: "Matches what we do",
};

export interface EventTarget {
  relationshipId?: ID;
  contactId?: ID;
  fullName: string;
  reasonCode: EventReasonCode;
  rationale: string;
  evidence: EvidenceRef[];
  score: number;
  state: "suggested" | "accepted" | "dismissed";
}

/* -------------------------------------------------- derived thread reading */

/** What a stream of messages says about who owes whom. Always derived. */
export interface ThreadRead {
  state: ThreadState;
  lastMessageAt?: ISODateTime;
  lastInboundAt?: ISODateTime;
  lastOutboundAt?: ISODateTime;
  /** When a reply we owe becomes late. Only ever set for `waiting_on_us`. */
  responseDueAt?: ISODateTime;
  messageCount: number;
}

/* -------------------------------------------------- gmail run bookkeeping */

/**
 * The persisted summary of one sync pass, stored on the connection's cursor
 * so the status surface can tell the truth about the last read without
 * touching the mailbox again. Counts only — never message content.
 */
export interface GmailRunSummary {
  at: ISODateTime;
  messagesRead: number;
  messagesStored: number;
  relationshipsTouched: number;
  /** Labeled messages held back because the person is not in Comms yet. */
  skippedUnknownPeople: number;
  /** Distinct labeled correspondents not yet in Comms — the review queue. */
  pendingPeople: number;
  eventsEmitted: number;
  draftsVerified: number;
}

function runCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : 0;
}

/** Defensive read of `cursor.last_run`; anything malformed is simply absent. */
export function readGmailRunSummary(cursor: Record<string, unknown>): GmailRunSummary | null {
  const raw = cursor["last_run"];
  if (!raw || typeof raw !== "object") return null;
  const run = raw as Record<string, unknown>;
  if (typeof run["at"] !== "string" || run["at"].length === 0) return null;
  return {
    at: run["at"],
    messagesRead: runCount(run["messages_read"]),
    messagesStored: runCount(run["messages_stored"]),
    relationshipsTouched: runCount(run["relationships_touched"]),
    skippedUnknownPeople: runCount(run["skipped_unknown_people"]),
    pendingPeople: runCount(run["pending_people"]),
    eventsEmitted: runCount(run["events_emitted"]),
    draftsVerified: runCount(run["drafts_verified"]),
  };
}

/* --------------------------------------------------- relationship coverage */

/**
 * Relationship coverage: of the correspondents on labeled threads, how many
 * are already relationships in Comms and how many still wait for a human
 * Add-to-Comms decision. Computed over the full window before any display
 * cap, so the count stays honest when the list is shortened.
 */
export interface MailboxCoverage {
  windowDays: number;
  correspondents: number;
  tracked: number;
  pending: number;
}

export function summarizeMailboxCoverage(
  people: { alreadyTracked: boolean }[],
  windowDays: number,
): MailboxCoverage {
  const tracked = people.filter((person) => person.alreadyTracked).length;
  return {
    windowDays,
    correspondents: people.length,
    tracked,
    pending: people.length - tracked,
  };
}
