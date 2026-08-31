/**
 * The labeled inbox, as a pure function.
 *
 * Comms only ever ingests Gmail threads a person labeled `Trust Tai/Comms`,
 * so everything already on record here arrived by that one human act. This
 * module simply regroups those stored messages the way a mailbox reads them:
 * one row per conversation, newest first, with the person it belongs to.
 *
 * Nothing is invented. A relationship with no synced messages has no thread,
 * and a message without a provider thread id is not mailbox mail.
 */

import type { Relationship } from "./comms";
import { readAtOf } from "./comms-dashboard";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { ISODateTime } from "./entities";

export interface LabeledThread {
  /** Gmail's own conversation id — the thing the label was applied to. */
  threadId: string;
  relationship: Relationship;
  /** Every stored message in this conversation, oldest first. */
  messages: StoredMailboxMessage[];
  lastMessage: StoredMailboxMessage;
  subject: string;
  /** Inbound messages newer than the last time a person opened this person. */
  unreadCount: number;
  lastActivityAt: ISODateTime;
  mailbox?: string;
}

function time(value: string | null | undefined): number {
  if (!value) return 0;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? 0 : at;
}

/**
 * Every labeled conversation on record, newest activity first.
 *
 * Threads are keyed by Gmail's conversation id so a long back-and-forth stays
 * one row, exactly as the person sees it in their mailbox.
 */
export function labeledThreads(
  relationships: Relationship[],
  messagesByRelationship: Record<string, StoredMailboxMessage[]>,
): LabeledThread[] {
  const threads: LabeledThread[] = [];

  for (const relationship of relationships) {
    const readAt = time(readAtOf(relationship));
    const grouped = new Map<string, StoredMailboxMessage[]>();

    for (const message of messagesByRelationship[relationship.id] ?? []) {
      const key = message.providerThreadId ?? message.threadId ?? null;
      if (!key) continue;
      const bucket = grouped.get(key);
      if (bucket) bucket.push(message);
      else grouped.set(key, [message]);
    }

    for (const [threadId, messages] of grouped) {
      const ordered = [...messages].sort(
        (a, b) => time(a.occurredAt) - time(b.occurredAt),
      );
      const last = ordered[ordered.length - 1]!;
      threads.push({
        threadId,
        relationship,
        messages: ordered,
        lastMessage: last,
        subject:
          ordered.find((message) => message.subject?.trim())?.subject?.trim() ||
          "No subject",
        unreadCount: ordered.filter(
          (message) => message.direction === "inbound" && time(message.occurredAt) > readAt,
        ).length,
        lastActivityAt: last.occurredAt,
        ...(last.mailbox ? { mailbox: last.mailbox } : {}),
      });
    }
  }

  return threads.sort((a, b) => time(b.lastActivityAt) - time(a.lastActivityAt));
}

export type InboxScope = "all" | "unread" | "needs_reply";

export const INBOX_SCOPE_LABEL: Record<InboxScope, string> = {
  all: "All labeled",
  unread: "Unread",
  needs_reply: "Waiting on you",
};

export const INBOX_SCOPES: InboxScope[] = ["all", "unread", "needs_reply"];

/** Waiting on you means the last word in the conversation was theirs. */
export function waitingOnYou(thread: LabeledThread): boolean {
  return thread.lastMessage.direction === "inbound";
}

export function inInboxScope(thread: LabeledThread, scope: InboxScope): boolean {
  if (scope === "all") return true;
  if (scope === "unread") return thread.unreadCount > 0;
  return waitingOnYou(thread);
}

export function inboxScopeCounts(threads: LabeledThread[]): Record<InboxScope, number> {
  const counts: Record<InboxScope, number> = { all: 0, unread: 0, needs_reply: 0 };
  for (const thread of threads) {
    for (const scope of INBOX_SCOPES) if (inInboxScope(thread, scope)) counts[scope] += 1;
  }
  return counts;
}

export function matchesInboxSearch(thread: LabeledThread, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [
    thread.relationship.fullName,
    thread.relationship.companyName ?? "",
    thread.relationship.email ?? "",
    thread.subject,
  ]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

/** The subject a reply should carry: theirs, prefixed once. */
export function replySubject(thread: LabeledThread): string {
  const subject = thread.subject === "No subject" ? "" : thread.subject;
  if (!subject) return "";
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}
