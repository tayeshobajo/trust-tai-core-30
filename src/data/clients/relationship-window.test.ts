import { describe, expect, it } from "vitest";

import type { StoredMailboxMessage } from "@/domain/comms-integrations";
import type { Relationship } from "@/domain/comms";

import { relationshipWindow } from "./relationship-window";

function person(id: string, fullName: string, extra: Partial<Relationship> = {}): Relationship {
  return {
    id,
    organizationId: "org-1",
    fullName,
    companyName: "Mental Dental",
    email: `${id}@example.test`,
    stage: "warm",
    decided: [],
    observed: [],
    inferred: [],
    metadata: {},
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    ...extra,
  } as unknown as Relationship;
}

function message(
  id: string,
  relationshipId: string,
  direction: "inbound" | "outbound",
  occurredAt: string,
  extra: Partial<StoredMailboxMessage> = {},
): StoredMailboxMessage {
  return {
    id,
    organizationId: "org-1",
    relationshipId,
    direction,
    occurredAt,
    threadId: `thread-${relationshipId}`,
    subject: `${direction} ${id}`,
    ...extra,
  } as StoredMailboxMessage;
}

const NOW = new Date("2026-03-01T10:00:00.000Z");

describe("relationshipWindow", () => {
  it("counts each direction and names the latest message on each side", () => {
    const window = relationshipWindow({
      relationships: [person("rel-1", "Mara Whitlock")],
      messagesByRelationship: {
        "rel-1": [
          message("m1", "rel-1", "inbound", "2026-02-01T10:00:00.000Z", { subject: "Kickoff" }),
          message("m2", "rel-1", "outbound", "2026-02-02T10:00:00.000Z", { subject: "Reply" }),
          message("m3", "rel-1", "inbound", "2026-02-10T10:00:00.000Z", { subject: "Latest in" }),
        ],
      },
      now: NOW,
    });

    const [entry] = window.people;
    expect(entry?.messageCount).toBe(3);
    expect(entry?.inboundCount).toBe(2);
    expect(entry?.outboundCount).toBe(1);
    expect(entry?.latestInbound?.subject).toBe("Latest in");
    expect(entry?.latestOutbound?.subject).toBe("Reply");
    expect(entry?.threadCount).toBe(1);
  });

  it("says nothing rather than guessing when Comms has no messages for a person", () => {
    const window = relationshipWindow({
      relationships: [person("rel-2", "Quiet Person")],
      messagesByRelationship: {},
      now: NOW,
    });

    const [entry] = window.people;
    expect(entry?.messageCount).toBe(0);
    expect(entry?.latestInbound).toBeNull();
    expect(entry?.latestOutbound).toBeNull();
  });

  it("puts the most recently spoken to person first", () => {
    const window = relationshipWindow({
      relationships: [person("rel-a", "Older"), person("rel-b", "Newer")],
      messagesByRelationship: {
        "rel-a": [message("m1", "rel-a", "inbound", "2026-01-01T10:00:00.000Z")],
        "rel-b": [message("m2", "rel-b", "inbound", "2026-02-20T10:00:00.000Z")],
      },
      now: NOW,
    });

    expect(window.people.map((entry) => entry.fullName)).toEqual(["Newer", "Older"]);
  });

  it("repeats an open promise as an obligation and counts it as owed", () => {
    const owing = person("rel-3", "Owed Person", {
      lastTouchAt: "2026-02-01T10:00:00.000Z",
      observed: [
        {
          id: "m1",
          label: "Promise",
          value: "Send the delivery outline",
          tier: "observed",
          at: "2026-02-01T10:00:00.000Z",
          category: "commitment",
          metadata: { owner: "us", due: "2026-02-10T10:00:00.000Z", status: "open" },
        },
      ],
    } as unknown as Partial<Relationship>);

    const window = relationshipWindow({
      relationships: [owing],
      messagesByRelationship: {},
      now: NOW,
    });

    const [entry] = window.people;
    expect(entry?.obligation).not.toBeNull();
    expect(entry?.obligation?.action.length).toBeGreaterThan(0);
    expect(window.owed).toBe(1);
  });

  it("never invents an obligation for an archived relationship", () => {
    const window = relationshipWindow({
      relationships: [person("rel-4", "Archived Person", { stage: "archived" })],
      messagesByRelationship: {},
      now: NOW,
    });

    expect(window.people[0]?.obligation).toBeNull();
    expect(window.owed).toBe(0);
  });
});
