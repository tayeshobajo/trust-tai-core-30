/**
 * Recent email, pinned.
 *
 * Synthetic fixtures only. These tests hold the rules the Dashboard card
 * rests on: mailbox plus thread is the conversation, reply state is read from
 * the last message and never claims obligations are settled, and a mailbox
 * whose sync is old says so.
 */

import { describe, expect, it } from "vitest";

import {
  mailboxSyncLines,
  recentEmailRows,
  threadKeyOf,
  windowNote,
  MAILBOX_STALE_AFTER_MS,
} from "./comms-recent-email";
import type { StoredMailboxMessage } from "./comms-integrations";
import type { Relationship } from "./comms";
import type { IntegrationConnection } from "./comms-integrations";

function message(over: Partial<StoredMailboxMessage> & { id: string }): StoredMailboxMessage {
  return {
    organizationId: "org-1",
    relationshipId: "rel-1",
    direction: "inbound",
    occurredAt: "2026-09-10T09:00:00.000Z",
    ...over,
  } as StoredMailboxMessage;
}

const person: Relationship = {
  id: "rel-1",
  organizationId: "org-1",
  fullName: "Dana Wright",
  companyName: "Northwind",
  stage: "active",
  metadata: {},
} as unknown as Relationship;

describe("recentEmailRows", () => {
  it("keeps an inbound message visible after a reply and says you replied", () => {
    const rows = recentEmailRows(
      [
        message({
          id: "m1",
          providerThreadId: "t1",
          mailbox: "tai@trust-tai.com",
          subject: "Two questions",
        }),
        message({
          id: "m2",
          providerThreadId: "t1",
          mailbox: "tai@trust-tai.com",
          direction: "outbound",
          occurredAt: "2026-09-10T10:00:00.000Z",
        }),
      ],
      [person],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.replyState).toBe("you_replied");
    expect(rows[0]!.lastInbound?.id).toBe("m1");
    expect(rows[0]!.lastOutbound?.id).toBe("m2");
    expect(rows[0]!.subject).toBe("Two questions");
  });

  it("keeps two simultaneous threads with one person separate", () => {
    const rows = recentEmailRows(
      [
        message({ id: "a", providerThreadId: "t1", mailbox: "tai@trust-tai.com", subject: "Scope" }),
        message({
          id: "b",
          providerThreadId: "t2",
          mailbox: "tai@trust-tai.com",
          subject: "Invoice",
          occurredAt: "2026-09-11T09:00:00.000Z",
        }),
      ],
      [person],
    );

    expect(rows.map((row) => row.subject)).toEqual(["Invoice", "Scope"]);
  });

  it("does not merge the same thread id seen in two mailboxes", () => {
    const rows = recentEmailRows(
      [
        message({ id: "a", providerThreadId: "shared", mailbox: "one@trust-tai.com" }),
        message({ id: "b", providerThreadId: "shared", mailbox: "two@trust-tai.com" }),
      ],
      [person],
    );

    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.mailbox)).size).toBe(2);
  });

  it("collapses a repeated import of the same provider message", () => {
    const rows = recentEmailRows(
      [
        message({ id: "a", providerMessageId: "g1", providerThreadId: "t1", mailbox: "one@x.com" }),
        message({ id: "b", providerMessageId: "g1", providerThreadId: "t1", mailbox: "one@x.com" }),
      ],
      [person],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]!.messageCount).toBe(1);
  });

  it("orders newest first and falls back to a per-message key without a thread", () => {
    const older = message({ id: "old", occurredAt: "2026-09-01T09:00:00.000Z" });
    const newer = message({ id: "new", occurredAt: "2026-09-12T09:00:00.000Z" });
    const rows = recentEmailRows([older, newer], [person]);

    expect(rows.map((row) => row.lastMessage.id)).toEqual(["new", "old"]);
    expect(threadKeyOf(older)).toContain("message:old");
  });

  it("reads an outbound-only conversation as you wrote last, never as settled", () => {
    const rows = recentEmailRows(
      [message({ id: "a", direction: "outbound", providerThreadId: "t9", mailbox: "one@x.com" })],
      [person],
    );

    expect(rows[0]!.replyState).toBe("you_wrote_last");
  });

  it("names a person from the message when no relationship is loaded", () => {
    const rows = recentEmailRows(
      [message({ id: "a", fromName: "Sam Reed", relationshipId: "rel-unknown" })],
      [],
    );

    expect(rows[0]!.personName).toBe("Sam Reed");
  });

  it("reads timestamps as instants, not local strings", () => {
    const rows = recentEmailRows(
      [
        message({ id: "a", providerThreadId: "t1", mailbox: "m", occurredAt: "2026-09-10T23:30:00.000Z" }),
        message({ id: "b", providerThreadId: "t2", mailbox: "m", occurredAt: "2026-09-11T00:30:00+02:00" }),
      ],
      [person],
    );

    // 00:30+02:00 is 22:30Z, which is earlier than 23:30Z.
    expect(rows[0]!.lastMessage.id).toBe("a");
  });
});

describe("mailboxSyncLines", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  function connection(over: Partial<IntegrationConnection>): IntegrationConnection {
    return {
      id: "int-1",
      organizationId: "org-1",
      provider: "gmail",
      status: "connected",
      accountEmail: "tai@trust-tai.com",
      scopes: [],
      cursor: {},
      updatedAt: now.toISOString(),
      ...over,
    } as IntegrationConnection;
  }

  it("calls a mailbox stale when the last successful read is old", () => {
    const [line] = mailboxSyncLines(
      [connection({ lastSyncAt: new Date(now.getTime() - MAILBOX_STALE_AFTER_MS - 1000).toISOString() })],
      now,
    );

    expect(line!.state).toBe("stale");
    expect(line!.note).toContain("Newer mail may not be here yet");
  });

  it("reports an errored mailbox even when an older read succeeded", () => {
    const [line] = mailboxSyncLines(
      [
        connection({
          status: "error",
          lastSyncAt: new Date(now.getTime() - 60_000).toISOString(),
        }),
      ],
      now,
    );

    expect(line!.state).toBe("error");
  });

  it("says a fresh mailbox is fresh and never shows a token", () => {
    const [line] = mailboxSyncLines(
      [connection({ lastSyncAt: new Date(now.getTime() - 60_000).toISOString() })],
      now,
    );

    expect(line!.state).toBe("fresh");
    expect(line!.note).not.toMatch(/token|secret/i);
  });
});

describe("windowNote", () => {
  it("states the window and the scoped total", () => {
    expect(windowNote(30, 4)).toBe("4 conversations with labelled mail in the last 30 days.");
  });
});
