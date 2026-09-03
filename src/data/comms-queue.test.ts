import { describe, expect, it } from "vitest";

import { bucketFor, coverage, groupQueue, matchesSearch } from "./comms-queue";
import { primaryReason, reasonsToReconnect } from "./comms-reminders";
import { checkVoice, requiresHumanReview } from "./voice-policy";
import type { MemoryItem, Relationship } from "@/domain/comms";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function memory(partial: Partial<MemoryItem>): MemoryItem {
  return {
    label: "Note",
    value: "Something true",
    tier: "observed",
    evidence: [],
    at: "2026-02-01T00:00:00.000Z",
    ...partial,
  };
}

function relationship(partial: Partial<Relationship> = {}): Relationship {
  return {
    id: "r1",
    organizationId: "org",
    fullName: "Dana Reeves",
    stage: "new",
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...partial,
  };
}

describe("queue bucketing", () => {
  it("puts an overdue reply above everything else", () => {
    const entry = relationship({
      source: "scout_handoff",
      responseDueAt: "2026-03-05T00:00:00.000Z",
    });
    expect(bucketFor(entry, NOW)).toBe("needs_you");
  });

  it("keeps new Scout handoffs and in-person meetings apart", () => {
    expect(bucketFor(relationship({ source: "scout_handoff" }), NOW)).toBe("new_from_scout");
    expect(bucketFor(relationship({ source: "in_person" }), NOW)).toBe("met_in_person");
  });

  it("calls a long silence quiet rather than late", () => {
    const entry = relationship({
      stage: "in_conversation",
      lastTouchAt: "2025-12-01T00:00:00.000Z",
    });
    expect(bucketFor(entry, NOW)).toBe("quiet");
  });

  it("never places an archived relationship in a group", () => {
    const groups = groupQueue([relationship({ stage: "archived" })], NOW);
    expect(groups).toHaveLength(0);
  });
});

describe("coverage", () => {
  it("counts what nobody is carrying", () => {
    const read = coverage(
      [
        relationship({ id: "a", responseDueAt: "2026-03-01T00:00:00.000Z" }),
        relationship({ id: "b", ownerUserId: "u1", nextAction: "Send the audit" }),
        relationship({ id: "c", stage: "archived" }),
      ],
      NOW,
    );
    expect(read.total).toBe(2);
    expect(read.overdue).toBe(1);
    expect(read.unowned).toBe(1);
    expect(read.withoutNextMove).toBe(1);
  });
});

describe("search", () => {
  it("matches on where you met", () => {
    const entry = relationship({ metWhere: "Nashville Tech Council" });
    expect(matchesSearch(entry, "nashville")).toBe(true);
    expect(matchesSearch(entry, "memphis")).toBe(false);
  });
});

describe("reasons to reconnect", () => {
  it("returns nothing when nothing true has happened", () => {
    expect(
      reasonsToReconnect(relationship({ lastTouchAt: "2026-03-08T00:00:00.000Z" }), NOW),
    ).toEqual([]);
  });

  it("surfaces a commitment we made, with its evidence", () => {
    const entry = relationship({
      decided: [
        memory({ tier: "decided", label: "Commitment", value: "We said we would send the audit" }),
      ],
    });
    const reason = primaryReason(entry, NOW);
    expect(reason?.reasonCode).toBe("commitment_made");
    expect(reason?.evidence.length).toBeGreaterThan(0);
  });

  it("surfaces an unfollowed in-person meeting", () => {
    const entry = relationship({ source: "in_person", metWhere: "Chamber breakfast" });
    expect(reasonsToReconnect(entry, NOW).some((r) => r.reasonCode === "event_follow_up")).toBe(
      true,
    );
  });

  it("says nothing for an archived relationship", () => {
    expect(reasonsToReconnect(relationship({ stage: "archived" }), NOW)).toEqual([]);
  });
});

describe("voice policy", () => {
  it("repairs em dashes rather than accepting them", () => {
    const verdict = checkVoice("Good to meet you \u2014 the site looks sharp.", {
      register: "follow_up",
      requireSignoff: false,
    });
    expect(verdict.text).not.toContain("\u2014");
  });

  it("blocks a generic check-in", () => {
    const verdict = checkVoice("Just checking in on this.", {
      register: "follow_up",
      requireSignoff: false,
    });
    expect(verdict.violations.some((v) => v.ruleId === "no_generic_check_in")).toBe(true);
    expect(verdict.passes).toBe(false);
  });

  it("holds anything sensitive for a person", () => {
    const verdict = checkVoice("Thinking of you after the news.", {
      register: "sensitive",
      requireSignoff: false,
    });
    expect(requiresHumanReview("sensitive", verdict)).toBe(true);
  });
});
