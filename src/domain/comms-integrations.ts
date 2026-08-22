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

/** Read-only is the whole point in v1: no send scope is ever requested. */
export const GMAIL_READ_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

/* --------------------------------------------------------------- messages */

export type MessageDirection = "inbound" | "outbound";

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
}

export interface NormalizedThread {
  providerThreadId: string;
  subject?: string;
  messages: NormalizedMessage[];
}

/**
 * A mailbox message as Comms stored it — the row the relationship timeline
 * reads. Provider ids stay server-side in `comms_messages`; this shape is all
 * the UI is allowed to know.
 */
export interface StoredMailboxMessage {
  id: ID;
  organizationId: ID;
  relationshipId: ID;
  direction: MessageDirection;
  fromEmail?: string;
  fromName?: string;
  subject?: string;
  snippet?: string;
  occurredAt: ISODateTime;
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
