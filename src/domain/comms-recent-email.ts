/**
 * Recent email, as a pure function.
 *
 * The Dashboard needs one honest answer: what mail has actually arrived, in
 * which mailbox, and who spoke last. Everything here is derived from records
 * that already exist in `comms_messages`; nothing is inferred from silence and
 * nothing claims an obligation is settled.
 *
 * Three rules hold:
 *  1. A conversation is a mailbox plus a provider thread, never a person. Two
 *     subjects running at once with the same person stay two rows, and the
 *     same provider thread id seen in two mailboxes stays two rows.
 *  2. The latest incoming and the latest outgoing are tracked separately, so
 *     "You replied" is a statement about the last message only. It never means
 *     the conversation is finished or that nothing is owed.
 *  3. Receipt and unread state are not obligations. Nothing in this module
 *     creates a reply owed; that rule lives on the relationship and stays
 *     exactly where it was.
 */

import type { Relationship } from "./comms";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { IntegrationConnection } from "./comms-integrations";
import type { ISODateTime } from "./entities";

/** The declared window the Dashboard reads. Stated on screen, never implied. */
export const RECENT_EMAIL_WINDOW_DAYS = 30;

/** How many rows open with, and how many each "Show more" adds. */
export const RECENT_EMAIL_PAGE = 10;

export type ReplyState = "they_wrote_last" | "you_replied" | "you_wrote_last";

export const REPLY_STATE_LABEL: Record<ReplyState, string> = {
  they_wrote_last: "They wrote last",
  you_replied: "You replied",
  you_wrote_last: "You wrote last",
};

/**
 * What each state does and does not say. Shown as plain text, so reply state
 * is never carried by colour alone and never reads as "all settled".
 */
export const REPLY_STATE_NOTE: Record<ReplyState, string> = {
  they_wrote_last: "The last message on record is theirs.",
  you_replied: "Your reply is the last message on record. Anything else owed is unchanged.",
  you_wrote_last: "The last message on record is yours. No reply has arrived.",
};

export interface RecentEmailRow {
  /** Stable row identity: mailbox plus thread, with a safe fallback. */
  key: string;
  relationshipId: string;
  personName: string;
  companyName: string | null;
  /** The mailbox the message arrived in, when the record carries one. */
  mailbox: string | null;
  /** Gmail's conversation id when known, otherwise the internal thread id. */
  threadId: string | null;
  subject: string;
  lastMessage: StoredMailboxMessage;
  lastInbound: StoredMailboxMessage | null;
  lastOutbound: StoredMailboxMessage | null;
  replyState: ReplyState;
  messageCount: number;
  lastActivityAt: ISODateTime;
}

function time(value: string | null | undefined): number {
  if (!value) return 0;
  const at = new Date(value).getTime();
  return Number.isNaN(at) ? 0 : at;
}

/** Mailbox and thread together, with a fallback that cannot merge strangers. */
export function threadKeyOf(message: StoredMailboxMessage): string {
  const mailbox = message.mailbox ?? "mailbox-not-recorded";
  const thread = message.providerThreadId ?? message.threadId ?? `message:${message.id}`;
  return `${mailbox}::${thread}`;
}

/** The same message imported twice is one message. Provider id decides. */
function dedupe(messages: StoredMailboxMessage[]): StoredMailboxMessage[] {
  const seen = new Map<string, StoredMailboxMessage>();
  for (const message of messages) {
    const key = message.providerMessageId ?? message.id;
    if (!seen.has(key)) seen.set(key, message);
  }
  return [...seen.values()];
}

/**
 * Recent email conversations, newest activity first.
 *
 * `messages` is whatever the read returned, in any order. Relationships supply
 * the person's name; a message whose relationship is not in the list still
 * appears, named by the address on the message, because hiding real mail would
 * be the larger lie.
 */
export function recentEmailRows(
  messages: StoredMailboxMessage[],
  relationships: Relationship[],
): RecentEmailRow[] {
  const people = new Map(relationships.map((relationship) => [relationship.id, relationship]));
  const grouped = new Map<string, StoredMailboxMessage[]>();

  for (const message of dedupe(messages)) {
    const key = threadKeyOf(message);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(message);
    else grouped.set(key, [message]);
  }

  const rows: RecentEmailRow[] = [];
  for (const [key, bucket] of grouped) {
    const ordered = [...bucket].sort((a, b) => time(a.occurredAt) - time(b.occurredAt));
    const last = ordered[ordered.length - 1]!;
    const lastInbound =
      [...ordered].reverse().find((message) => message.direction === "inbound") ?? null;
    const lastOutbound =
      [...ordered].reverse().find((message) => message.direction === "outbound") ?? null;
    const relationship = people.get(last.relationshipId);

    const replyState: ReplyState =
      last.direction === "inbound"
        ? "they_wrote_last"
        : lastInbound
          ? "you_replied"
          : "you_wrote_last";

    rows.push({
      key,
      relationshipId: last.relationshipId,
      personName:
        relationship?.fullName ??
        lastInbound?.fromName ??
        lastInbound?.fromEmail ??
        last.fromName ??
        last.fromEmail ??
        "Person not named on the record",
      companyName: relationship?.companyName ?? null,
      mailbox: last.mailbox ?? null,
      threadId: last.providerThreadId ?? last.threadId ?? null,
      subject: ordered.find((message) => message.subject?.trim())?.subject?.trim() || "No subject",
      lastMessage: last,
      lastInbound,
      lastOutbound,
      replyState,
      messageCount: ordered.length,
      lastActivityAt: last.occurredAt,
    });
  }

  return rows.sort((a, b) => {
    const gap = time(b.lastActivityAt) - time(a.lastActivityAt);
    return gap !== 0 ? gap : a.key.localeCompare(b.key);
  });
}

/* ------------------------------------------------------- mailbox freshness */

export type MailboxSyncState = "fresh" | "stale" | "error" | "never" | "disconnected";

/** After this long without a successful pass, the mailbox reads as stale. */
export const MAILBOX_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export interface MailboxSyncLine {
  integrationId: string;
  mailbox: string;
  state: MailboxSyncState;
  lastSyncAt: ISODateTime | null;
  /** Plain words, safe to show. Never a token, never a vendor id. */
  note: string;
}

function ago(from: number, to: number): string {
  const minutes = Math.floor((to - from) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * One line per connected mailbox: when it last synced successfully, and
 * whether that is recent enough to trust. A mailbox in error says so even if
 * an older pass succeeded, because the newer failure is the live fact.
 */
export function mailboxSyncLines(
  connections: IntegrationConnection[],
  now: Date = new Date(),
  staleAfterMs: number = MAILBOX_STALE_AFTER_MS,
): MailboxSyncLine[] {
  return connections.map((connection) => {
    const mailbox = connection.accountEmail ?? "Mailbox address not recorded";
    const lastSyncAt = connection.lastSyncAt ?? null;
    const at = time(lastSyncAt);
    const when = at ? ago(at, now.getTime()) : null;

    if (connection.status === "disconnected" || connection.status === "revoked") {
      return {
        integrationId: connection.id,
        mailbox,
        state: "disconnected",
        lastSyncAt,
        note:
          connection.status === "revoked"
            ? "Access was revoked, so no new mail can be read from this mailbox."
            : "This mailbox is not connected, so no new mail is being read.",
      };
    }

    if (connection.status === "error") {
      return {
        integrationId: connection.id,
        mailbox,
        state: "error",
        lastSyncAt,
        note: when
          ? `The last attempt did not finish. The last successful read was ${when}.`
          : "The last attempt did not finish and no successful read is recorded.",
      };
    }

    if (!at) {
      return {
        integrationId: connection.id,
        mailbox,
        state: "never",
        lastSyncAt,
        note: "No successful read is recorded for this mailbox yet.",
      };
    }

    const stale = now.getTime() - at > staleAfterMs;
    return {
      integrationId: connection.id,
      mailbox,
      state: stale ? "stale" : "fresh",
      lastSyncAt,
      note: stale
        ? `Last successful read ${when}. Newer mail may not be here yet.`
        : `Last successful read ${when}.`,
    };
  });
}

/** The exact window sentence the card shows, so the scope is never implied. */
export function windowNote(windowDays: number, total: number): string {
  const mail = total === 1 ? "conversation" : "conversations";
  return `${total} ${mail} with labelled mail in the last ${windowDays} days.`;
}
