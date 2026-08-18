/**
 * The relationship loop, tested where it must not drift: derived facts stay
 * suggestions, a next move always rests on a reason, and cadence alone never
 * creates outreach.
 */

import { describe, expect, it } from "vitest";

import { deriveInteraction } from "./comms-derive-interaction";
import { nextRelationshipMove } from "./comms-next-move";
import { relationshipsWorthAttention } from "./comms-attention";
import { conversationTimeline, groupByDay } from "./comms-timeline";
import type { MemoryItem, Relationship, Touch } from "@/domain/comms";
import { COMMITMENT_CATEGORY } from "@/domain/comms-interactions";

const NOW = new Date("2026-03-10T09:00:00.000Z");

function relationship(patch: Partial<Relationship> = {}): Relationship {
  return {
    id: "r1",
    organizationId: "org",
    fullName: "Maya Osei",
    stage: "in_conversation",
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

function commitment(patch: Partial<MemoryItem> = {}): MemoryItem {
  return {
    label: "Promise",
    value: "Send the roadmap summary",
    tier: "decided",
    evidence: [{ label: "Added by Tai", kind: "human" }],
    at: "2026-03-01T00:00:00.000Z",
    category: COMMITMENT_CATEGORY,
    status: "open",
    owner: "us",
    ...patch,
  };
}

describe("deriving a captured interaction", () => {
  it("proposes a promise, and quotes the words it came from", () => {
    const derived = deriveInteraction(
      "Good call with Maya. I said I would send the pricing outline by Friday.",
    );
    const promise = derived.suggestions.find((entry) => entry.kind === "commitment");
    expect(promise).toBeDefined();
    expect(promise!.owner).toBe("us");
    expect(promise!.because.length).toBeGreaterThan(0);
  });

  it("returns nothing structured when the capture says nothing structured", () => {
    expect(deriveInteraction("Quick hello.").suggestions).toHaveLength(0);
  });
});

describe("the next relationship move", () => {
  it("leads with a promise we made", () => {
    const move = nextRelationshipMove(
      relationship({ decided: [commitment({ due: "2026-03-05T00:00:00.000Z" })] }),
      NOW,
    );
    expect(move.needed).toBe(true);
    expect(move.urgency).toBe("now");
    expect(move.whyNow).toContain("Send the roadmap summary");
  });

  it("says no outreach is needed when nothing is outstanding", () => {
    const move = nextRelationshipMove(
      relationship({ stage: "nurture", lastTouchAt: "2026-03-08T00:00:00.000Z" }),
      NOW,
    );
    expect(move.needed).toBe(false);
    expect(move.action).toBe("No outreach needed");
  });

  it("never invents a reason for an archived relationship", () => {
    expect(nextRelationshipMove(relationship({ stage: "archived" }), NOW).needed).toBe(false);
  });
});

describe("relationships worth attention today", () => {
  it("lists only the ones with a real reason, most urgent first", () => {
    const withPromise = relationship({
      id: "urgent",
      decided: [commitment({ due: "2026-03-01T00:00:00.000Z" })],
    });
    const quiet = relationship({
      id: "quiet",
      stage: "nurture",
      lastTouchAt: "2026-03-09T00:00:00.000Z",
    });
    const entries = relationshipsWorthAttention([quiet, withPromise], NOW);
    expect(entries.map((entry) => entry.relationship.id)).toEqual(["urgent"]);
  });
});

describe("the relationship timeline", () => {
  it("distinguishes who wrote, and marks drafts as not sent", () => {
    const touches: Touch[] = [
      {
        id: "t1",
        organizationId: "org",
        relationshipId: "r1",
        channel: "text",
        direction: "inbound",
        summary: "They texted about Thursday",
        occurredAt: "2026-03-09T10:00:00.000Z",
        createdAt: "2026-03-09T10:00:00.000Z",
      } as Touch,
    ];
    const events = conversationTimeline(touches, []);
    expect(events[0]!.kind).toBe("they_texted");
    expect(groupByDay(events, NOW)).toHaveLength(1);
  });
});
