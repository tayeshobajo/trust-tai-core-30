import { describe, expect, it } from "vitest";

import type { Relationship, Touch } from "@/domain/comms";

import { conversationHealth, relationshipStrength, responseCadence } from "./comms-health";
import { conversationTimeline, groupByDay } from "./comms-timeline";
import { inboxEntries, inboxView, needsYou, segmentViewOf } from "./comms-inbox";

const NOW = new Date("2026-08-17T12:00:00.000Z");

function days(count: number): string {
  return new Date(NOW.getTime() - count * 86_400_000).toISOString();
}

function relationship(part: Partial<Relationship> = {}): Relationship {
  return {
    id: "r1",
    organizationId: "org",
    fullName: "Dana Rivers",
    companyName: "Teamsynerg",
    stage: "in_conversation",
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: days(60),
    updatedAt: days(1),
    ...part,
  };
}

function touch(part: Partial<Touch> & { id: string; occurredAt: string }): Touch {
  return {
    organizationId: "org",
    relationshipId: "r1",
    channel: "email",
    direction: "outbound",
    summary: "A message",
    ...part,
  };
}

describe("conversationHealth", () => {
  it("is healthy with recent two-sided activity and nothing overdue", () => {
    const read = conversationHealth(
      relationship({ nextAction: "Send the pricing note", lastTouchAt: days(2) }),
      [
        touch({ id: "a", occurredAt: days(6), direction: "outbound" }),
        touch({ id: "b", occurredAt: days(5), direction: "inbound" }),
        touch({ id: "c", occurredAt: days(2), direction: "outbound" }),
      ],
      NOW,
    );
    expect(read.status).toBe("healthy");
    expect(read.waitingOn).toBe("waiting_on_them");
    expect(read.reasons.length).toBeGreaterThan(0);
  });

  it("needs attention when something real happened and no next move is set", () => {
    const read = conversationHealth(
      relationship({ lastTouchAt: days(3) }),
      [touch({ id: "a", occurredAt: days(3), direction: "inbound" })],
      NOW,
    );
    expect(read.status).toBe("needs_attention");
    expect(read.waitingOn).toBe("needs_us");
    expect(read.nextMoveStatus).toBe("none");
  });

  it("needs attention when the next move is due in a few days", () => {
    const read = conversationHealth(
      relationship({
        nextAction: "Share the deck",
        followUpDueAt: new Date(NOW.getTime() + 86_400_000).toISOString(),
        lastTouchAt: days(3),
      }),
      [touch({ id: "a", occurredAt: days(3), direction: "outbound" })],
      NOW,
    );
    expect(read.status).toBe("needs_attention");
    expect(read.nextMoveStatus).toBe("due_soon");
  });

  it("is at risk when a follow-up is materially overdue", () => {
    const read = conversationHealth(
      relationship({ nextAction: "Send the proposal", followUpDueAt: days(9), lastTouchAt: days(10) }),
      [touch({ id: "a", occurredAt: days(10), direction: "outbound" })],
      NOW,
    );
    expect(read.status).toBe("at_risk");
    expect(read.nextMoveStatus).toBe("overdue");
    expect(read.reasons[0]).toContain("outstanding");
  });

  it("is at risk after repeated outreach with nothing coming back", () => {
    const read = conversationHealth(
      relationship({ nextAction: "Wait", lastTouchAt: days(12) }),
      [
        touch({ id: "a", occurredAt: days(20), direction: "outbound" }),
        touch({ id: "b", occurredAt: days(12), direction: "outbound" }),
      ],
      NOW,
    );
    expect(read.status).toBe("at_risk");
  });

  it("is quiet, not bad, when nothing has happened and nothing is due", () => {
    const read = conversationHealth(
      relationship({ stage: "nurture", createdAt: days(200), lastTouchAt: days(120) }),
      [touch({ id: "a", occurredAt: days(120), direction: "inbound" })],
      NOW,
    );
    expect(["quiet", "at_risk"]).toContain(read.status);
    const fresh = conversationHealth(relationship({ stage: "nurture" }), [], NOW);
    expect(fresh.status).toBe("quiet");
    expect(fresh.reasons[0]).toContain("Nothing has happened");
  });

  it("never phrases health as a judgment about the person", () => {
    const reads = [
      conversationHealth(relationship(), [], NOW),
      conversationHealth(
        relationship({ followUpDueAt: days(9) }),
        [touch({ id: "a", occurredAt: days(10) })],
        NOW,
      ),
    ];
    for (const read of reads) {
      for (const reason of read.reasons) {
        expect(reason).not.toMatch(/disengaged|ignoring|unresponsive|not interested/i);
      }
    }
  });

  it("treats an archived conversation as expecting nothing", () => {
    const read = conversationHealth(relationship({ stage: "archived" }), [], NOW);
    expect(read.status).toBe("quiet");
    expect(read.nextMoveStatus).toBe("not_needed");
  });
});

describe("responseCadence", () => {
  it("reads a slowdown from the gaps themselves", () => {
    const cadence = responseCadence(
      [
        touch({ id: "a", occurredAt: days(40), direction: "outbound" }),
        touch({ id: "b", occurredAt: days(39), direction: "inbound" }),
        touch({ id: "c", occurredAt: days(30), direction: "outbound" }),
        touch({ id: "d", occurredAt: days(8), direction: "inbound" }),
      ],
      NOW,
    );
    expect(cadence).toBe("slowing");
  });

  it("says nothing when there is no history to read", () => {
    expect(responseCadence([], NOW)).toBe("unknown");
  });
});

describe("relationshipStrength", () => {
  it("is separate from health: a quiet thread can still be an established relationship", () => {
    const person = relationship({
      lastTouchAt: days(90),
      metWhere: "Nashville",
      decided: [
        { label: "Budget", value: "Confirmed", tier: "decided", evidence: [], at: days(30) },
      ],
    });
    const history: Touch[] = [
      touch({ id: "a", occurredAt: days(200), direction: "outbound" }),
      touch({ id: "b", occurredAt: days(190), direction: "inbound" }),
      touch({ id: "c", occurredAt: days(150), channel: "meeting", direction: "outbound" }),
      touch({ id: "d", occurredAt: days(120), direction: "inbound" }),
      touch({ id: "e", occurredAt: days(90), direction: "outbound" }),
    ];
    const strength = relationshipStrength(person, history, NOW);
    const health = conversationHealth(person, history, NOW);
    expect(strength.band).toBe("established");
    expect(health.status).not.toBe("healthy");
  });

  it("is untested with no history at all", () => {
    expect(relationshipStrength(relationship({ createdAt: days(1) }), [], NOW).band).toBe(
      "untested",
    );
  });
});

describe("conversation timeline", () => {
  it("reads as one thread in time order, with drafts inline", () => {
    const events = conversationTimeline(
      [
        touch({ id: "a", occurredAt: days(3), direction: "inbound", summary: "They wrote" }),
        touch({ id: "b", occurredAt: days(5), channel: "meeting", summary: "Met in Nashville" }),
        touch({ id: "c", occurredAt: days(1), channel: "note", summary: "Internal thought" }),
      ],
      [
        {
          id: "d1",
          organizationId: "org",
          relationshipId: "r1",
          intent: "Follow up",
          register: "follow_up",
          subject: "Following up",
          body: "Hello",
          voiceVersion: 1,
          reviewState: "draft",
          rationale: {},
          evidence: [],
          createdAt: days(2),
        },
      ],
    );
    expect(events.map((event) => event.kind)).toEqual([
      "meeting",
      "they_emailed",
      "draft",
      "note",
    ]);
    expect(groupByDay(events, NOW)).toHaveLength(4);
  });

  it("leaves discarded drafts out of the thread", () => {
    const events = conversationTimeline(
      [],
      [
        {
          id: "d1",
          organizationId: "org",
          relationshipId: "r1",
          intent: "Follow up",
          register: "follow_up",
          body: "Hello",
          voiceVersion: 1,
          reviewState: "discarded",
          rationale: {},
          evidence: [],
          createdAt: days(2),
        },
      ],
    );
    expect(events).toHaveLength(0);
  });
});

describe("inbox state", () => {
  const waiting = relationship({ id: "r1", fullName: "Dana Rivers", lastTouchAt: days(2) });
  const owed = relationship({
    id: "r2",
    fullName: "Lorena Diaz",
    companyName: "Northwind",
    responseDueAt: days(4),
  });
  const archived = relationship({ id: "r3", fullName: "Old Contact", stage: "archived" });

  const entries = inboxEntries(
    [waiting, owed, archived],
    {
      r1: [touch({ id: "a", occurredAt: days(2), direction: "outbound", relationshipId: "r1" })],
      r2: [touch({ id: "b", occurredAt: days(6), direction: "inbound", relationshipId: "r2" })],
    },
    NOW,
  );

  it("places each conversation in its one segment room", () => {
    expect(segmentViewOf(entries[0]!)).toBe("clients");
    expect(segmentViewOf(entries[1]!)).toBe("clients");
    expect(segmentViewOf(entries[2]!)).toBeNull();
  });

  it("All is the complete ledger: everyone exactly once, archived included", () => {
    const view = inboxView(entries, { tab: "all", now: NOW });
    expect(view.tabCounts.all).toBe(3);
    const ids = [...view.priority, ...view.others].map((entry) => entry.relationship.id);
    expect(new Set(ids).size).toBe(3);
  });

  it("Needs you crosses segments and rests on existing attention logic", () => {
    expect(needsYou(entries[1]!, NOW)).toBe(true);
    expect(needsYou(entries[2]!, NOW)).toBe(false);
    const view = inboxView(entries, { tab: "needs_you", now: NOW });
    const ids = [...view.priority, ...view.others].map((entry) => entry.relationship.id);
    expect(ids).toContain("r2");
    expect(ids).not.toContain("r3");
  });

  it("lifts conversations needing attention into Priority", () => {
    const view = inboxView(entries, { tab: "all" });
    expect(view.priority.map((entry) => entry.relationship.id)).toContain("r2");
    expect(view.others.map((entry) => entry.relationship.id)).not.toContain("r2");
  });

  it("health filters narrow the list to that signal", () => {
    const view = inboxView(entries, { tab: "all", health: "at_risk" });
    for (const entry of [...view.priority, ...view.others]) {
      expect(entry.health.status).toBe("at_risk");
    }
  });

  it("search matches people and companies", () => {
    const view = inboxView(entries, { tab: "all", query: "northwind" });
    expect([...view.priority, ...view.others]).toHaveLength(1);
  });
});
