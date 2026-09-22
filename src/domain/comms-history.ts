/**
 * Comms history: what has actually left, what came back, in one place.
 *
 * Three kinds of record, and each one says which it is:
 *  - Sent. An outbound message on the record, email or recorded by hand.
 *  - Reply. An inbound message on the record.
 *  - Sent draft. A piece of writing whose review ended in a send, kept so the
 *    words that went out can be found again, including one that failed.
 *
 * Nothing here infers delivery, reading or agreement. A record on this page
 * means a record exists, never that anything was received or accepted.
 *
 * Preparing a new draft from an entry never sends. It opens the same review
 * every other piece of writing has to clear, with the earlier words carried
 * in as the starting point.
 */

import type { Relationship } from "./comms";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { ISODateTime } from "./entities";

export type HistoryKind = "sent" | "reply" | "sent_draft" | "failed_draft";

export const HISTORY_KIND_LABEL: Record<HistoryKind, string> = {
  sent: "Sent",
  reply: "Reply",
  sent_draft: "Sent draft",
  failed_draft: "Send failed",
};

/** What each kind does and does not claim. Never carried by colour alone. */
export const HISTORY_KIND_NOTE: Record<HistoryKind, string> = {
  sent: "An outbound message is on the record. Delivery and reading are not claimed.",
  reply: "An inbound message is on the record.",
  sent_draft: "This draft's review ended in a send.",
  failed_draft: "This draft was approved, and the send did not complete.",
};

export type HistoryFilter = "all" | "sent" | "replies" | "drafts";

export const HISTORY_FILTERS: HistoryFilter[] = ["all", "sent", "replies", "drafts"];

export const HISTORY_FILTER_LABEL: Record<HistoryFilter, string> = {
  all: "Everything",
  sent: "Sent",
  replies: "Replies",
  drafts: "Sent drafts",
};

export interface HistoryEntry {
  /** Stable across reloads: the record's own id, prefixed by its store. */
  id: string;
  kind: HistoryKind;
  occurredAt: ISODateTime;
  relationshipId: string | null;
  personName: string;
  companyName: string | null;
  subject: string;
  /** A short, plain preview. Never a summary of what was meant. */
  preview: string;
  /** The best stored text, carried into a new draft when one is prepared. */
  body: string;
  recipientName: string;
  recipientEmail: string;
  threadId: string | null;
  messageId: string | null;
  channelLabel: string;
}

const UNKNOWN_PERSON = "Unknown person";

function trim(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function shorten(value: string, length = 240): string {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return "No text is stored for this record.";
  return text.length > length ? `${text.slice(0, length)}…` : text;
}

function channelOf(message: StoredMailboxMessage): string {
  if (message.sentByHandOnLinkedin) return "LinkedIn, recorded by hand";
  if (message.sentViaComms) return "Email, sent from Comms";
  return "Email";
}

/** People by id, so a record can name who it belongs to. */
export function peopleById(relationships: Relationship[]): Map<string, Relationship> {
  return new Map(relationships.map((relationship) => [relationship.id, relationship]));
}

export function entriesFromMessages(
  messages: StoredMailboxMessage[],
  people: Map<string, Relationship>,
): HistoryEntry[] {
  return messages.map((message) => {
    const person = message.relationshipId ? people.get(message.relationshipId) : undefined;
    const name = person?.fullName ?? trim(message.fromName) || UNKNOWN_PERSON;
    const body = trim(message.bodyText) || trim(message.snippet);
    return {
      id: `message:${message.id}`,
      kind: message.direction === "outbound" ? "sent" : "reply",
      occurredAt: message.occurredAt,
      relationshipId: message.relationshipId ?? null,
      personName: name,
      companyName: person?.companyName ?? null,
      subject: trim(message.subject) || "No subject",
      preview: shorten(body),
      body,
      recipientName: person?.fullName ?? name,
      recipientEmail: person?.email ?? trim(message.fromEmail),
      threadId: message.providerThreadId ?? message.threadId ?? null,
      messageId: message.id,
      channelLabel: channelOf(message),
    };
  });
}

export interface HistoryDraft {
  id: string;
  relationshipId: string;
  subject: string | null;
  body: string;
  reviewState: string;
  createdAt: ISODateTime;
}

/** Only drafts whose review ended in a send appear here. */
export function entriesFromDrafts(
  drafts: HistoryDraft[],
  people: Map<string, Relationship>,
): HistoryEntry[] {
  return drafts
    .filter((draft) => draft.reviewState === "sent" || draft.reviewState === "send_failed")
    .map((draft) => {
      const person = people.get(draft.relationshipId);
      const name = person?.fullName ?? UNKNOWN_PERSON;
      return {
        id: `draft:${draft.id}`,
        kind: draft.reviewState === "sent" ? ("sent_draft" as const) : ("failed_draft" as const),
        occurredAt: draft.createdAt,
        relationshipId: draft.relationshipId,
        personName: name,
        companyName: person?.companyName ?? null,
        subject: trim(draft.subject) || "No subject",
        preview: shorten(draft.body),
        body: draft.body,
        recipientName: name,
        recipientEmail: person?.email ?? "",
        threadId: null,
        messageId: null,
        channelLabel: "Prepared in Comms",
      };
    });
}

/** Newest first, with a stable order when two records share an instant. */
export function sortHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return [...entries].sort((left, right) => {
    const when = right.occurredAt.localeCompare(left.occurredAt);
    return when !== 0 ? when : left.id.localeCompare(right.id);
  });
}

export function inHistoryFilter(entry: HistoryEntry, filter: HistoryFilter): boolean {
  if (filter === "all") return true;
  if (filter === "sent") return entry.kind === "sent";
  if (filter === "replies") return entry.kind === "reply";
  return entry.kind === "sent_draft" || entry.kind === "failed_draft";
}

export function matchesHistoryQuery(entry: HistoryEntry, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [entry.personName, entry.companyName ?? "", entry.subject, entry.preview]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function historyCounts(entries: HistoryEntry[]): Record<HistoryFilter, number> {
  return {
    all: entries.length,
    sent: entries.filter((entry) => inHistoryFilter(entry, "sent")).length,
    replies: entries.filter((entry) => inHistoryFilter(entry, "replies")).length,
    drafts: entries.filter((entry) => inHistoryFilter(entry, "drafts")).length,
  };
}

/** What a new draft prepared from this record starts as. It never sends. */
export function draftSeedFrom(entry: HistoryEntry): {
  title: string;
  situation: string;
  goal: string;
  subject: string;
  body: string;
  recipientName: string;
  recipientEmail: string;
} {
  const again = entry.kind === "reply" ? "Reply to" : "Follow up on";
  const subject = entry.subject.toLowerCase().startsWith("re:")
    ? entry.subject
    : `Re: ${entry.subject}`;
  return {
    title: `${again} ${entry.subject} with ${entry.personName}`,
    situation: `${HISTORY_KIND_LABEL[entry.kind]} on ${entry.occurredAt.slice(0, 10)}, ${entry.channelLabel}. The earlier words are carried in below.`,
    goal: "",
    subject,
    body: entry.body,
    recipientName: entry.recipientName,
    recipientEmail: entry.recipientEmail,
  };
}
