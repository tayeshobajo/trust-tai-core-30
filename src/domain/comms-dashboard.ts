/**
 * The Comms dashboard read, as a pure function.
 *
 * One row per person: what they last said, how much of it you have not read
 * yet, and whether a human decided the conversation is finished.
 *
 * Two rules hold here:
 *  1. Unread is measured against a human act — the moment a person opened the
 *     conversation — never against a provider flag we do not own.
 *  2. Closed is a decision, so it is stored on the relationship and only ever
 *     changed by a person.
 */

import type { Relationship } from "./comms";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { ISODateTime } from "./entities";

/** Where the two dashboard decisions live inside relationship metadata. */
export const READ_AT_KEY = "comms_read_at";
export const CLOSED_AT_KEY = "comms_closed_at";

export interface ConversationRow {
  relationship: Relationship;
  /** The most recent message on record, in either direction. */
  lastMessage: StoredMailboxMessage | null;
  /** Inbound messages that arrived after this conversation was last opened. */
  unreadCount: number;
  messageCount: number;
  closedAt: ISODateTime | null;
  readAt: ISODateTime | null;
}

function stamp(metadata: Record<string, unknown>, key: string): ISODateTime | null {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function closedAtOf(relationship: Relationship): ISODateTime | null {
  return stamp(relationship.metadata ?? {}, CLOSED_AT_KEY);
}

export function readAtOf(relationship: Relationship): ISODateTime | null {
  return stamp(relationship.metadata ?? {}, READ_AT_KEY);
}

export function isClosed(relationship: Relationship): boolean {
  return closedAtOf(relationship) !== null;
}

function time(value: string | undefined | null): number {
  if (!value) return 0;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? 0 : at;
}

/** Inbound messages newer than the last time a person opened this thread. */
export function unreadCount(
  messages: StoredMailboxMessage[],
  readAt: ISODateTime | null,
): number {
  const since = time(readAt);
  return messages.filter(
    (message) => message.direction === "inbound" && time(message.occurredAt) > since,
  ).length;
}

/** One dashboard row per relationship, newest conversation first. */
export function conversationRows(
  relationships: Relationship[],
  messagesByRelationship: Record<string, StoredMailboxMessage[]>,
): ConversationRow[] {
  return relationships
    .map((relationship) => {
      const messages = [...(messagesByRelationship[relationship.id] ?? [])].sort(
        (a, b) => time(a.occurredAt) - time(b.occurredAt),
      );
      const readAt = readAtOf(relationship);
      return {
        relationship,
        lastMessage: messages[messages.length - 1] ?? null,
        unreadCount: unreadCount(messages, readAt),
        messageCount: messages.length,
        closedAt: closedAtOf(relationship),
        readAt,
      } satisfies ConversationRow;
    })
    .sort((a, b) => {
      const at = time(a.lastMessage?.occurredAt ?? a.relationship.lastTouchAt);
      const bt = time(b.lastMessage?.occurredAt ?? b.relationship.lastTouchAt);
      return bt - at;
    });
}

export type DashboardFilter = "open" | "unread" | "closed" | "all";

export const FILTER_LABEL: Record<DashboardFilter, string> = {
  open: "Open",
  unread: "Unread",
  closed: "Closed",
  all: "All",
};

export const FILTERS: DashboardFilter[] = ["open", "unread", "closed", "all"];

export function inFilter(row: ConversationRow, filter: DashboardFilter): boolean {
  if (filter === "all") return true;
  if (filter === "closed") return row.closedAt !== null;
  if (filter === "unread") return row.closedAt === null && row.unreadCount > 0;
  return row.closedAt === null;
}

export function filterCounts(rows: ConversationRow[]): Record<DashboardFilter, number> {
  const counts: Record<DashboardFilter, number> = { open: 0, unread: 0, closed: 0, all: 0 };
  for (const row of rows) {
    for (const filter of FILTERS) if (inFilter(row, filter)) counts[filter] += 1;
  }
  return counts;
}

/** The one line a row shows under the name. Never invented. */
export function previewOf(row: ConversationRow): string {
  const message = row.lastMessage;
  if (!message) return "No messages on record yet.";
  const words = (message.snippet ?? message.bodyText ?? message.subject ?? "").trim();
  if (!words) return message.direction === "outbound" ? "You sent a message." : "They wrote.";
  const lead = message.direction === "outbound" ? "You: " : "";
  return `${lead}${words.length > 160 ? `${words.slice(0, 157)}…` : words}`;
}

export function whenLabel(value: string | undefined | null, now: Date = new Date()): string {
  if (!value) return "—";
  const at = new Date(value).getTime();
  if (Number.isNaN(at)) return "—";
  const minutes = Math.floor((now.getTime() - at) / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}
