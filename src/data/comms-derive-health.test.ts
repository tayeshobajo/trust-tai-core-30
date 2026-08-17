/**
 * deriveConversationHealth() is the single canonical read behind every health
 * surface in Comms (cards, inbox, sidebar glance, driver). These tests hold it
 * to three promises: the same input always gives the same status and score, the
 * score tracks the status band, and every read explains itself in plain words.
 */

import { describe, expect, it } from "vitest";

import type { Relationship, Touch } from "@/domain/comms";

import { deriveConversationHealth } from "./comms-health";
import { glanceRows, commsDriver } from "@/components/tt/comms/comms-sidebar";
import { inboxEntries, inboxView } from "./comms-inbox";

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
    relationshipId: part.relationshipId ?? "r1",
    channel: "email",
    direction: "outbound",
    summary: "A message",
    ...part,
  };
}

const HEALTHY = {
  relationship: relationship({ nextAction: "Send the pricing note", lastTouchAt: days(2) }),
  touches: [
    touch({ id: "a", occurredAt: days(6), direction: "outbound" }),
    touch({ id: "b", occurredAt: days(5), direction: "inbound" }),
    touch({ id: "c", occurredAt: days(2), direction: "outbound" }),
  ],
};

const NEEDS_ATTENTION = {
  relationship: relationship({ id: "r2", lastTouchAt: days(3) }),
  touches: [touch({ id: "d", relationshipId: "r2", occurredAt: days(3), direction: "inbound" })],
};

const AT_RISK = {
  relationship: relationship({
    id: "r3",
    nextAction: "Send the proposal",
    followUpDueAt: days(9),
    lastTouchAt: days(10),
  }),
  touches: [touch({ id: "e", relationshipId: "r3", occurredAt: days(10), direction: "outbound" })],
};

const QUIET = { relationship: relationship({ id: "r4", stage: "nurture" }), touches: [] as Touch[] };

describe("deriveConversationHealth", () => {
  it("is deterministic — the same conversation reads the same twice", () => {
    const first = deriveConversationHealth(HEALTHY.relationship, HEALTHY.touches, NOW);
    const second = deriveConversationHealth(HEALTHY.relationship, [...HEALTHY.touches], NOW);
    expect(second).toEqual(first);
  });

  it("does not depend on the order touches arrive in", () => {
    const forward = deriveConversationHealth(HEALTHY.relationship, HEALTHY.touches, NOW);
    const reversed = deriveConversationHealth(
      HEALTHY.relationship,
      [...HEALTHY.touches].reverse(),
      NOW,
    );
    expect(reversed.status).toBe(forward.status);
    expect(reversed.score).toBe(forward.score);
  });

  it("reads a warm two-sided conversation as healthy", () => {
    const read = deriveConversationHealth(HEALTHY.relationship, HEALTHY.touches, NOW);
    expect(read.status).toBe("healthy");
    expect(read.waitingOn).toBe("waiting_on_them");
  });

  it("reads an unanswered inbound with no next move as needing attention", () => {
    const read = deriveConversationHealth(NEEDS_ATTENTION.relationship, NEEDS_ATTENTION.touches, NOW);
    expect(read.status).toBe("needs_attention");
    expect(read.nextMoveStatus).toBe("none");
    expect(read.waitingOn).toBe("needs_us");
  });

  it("reads a materially overdue follow-up as at risk", () => {
    const read = deriveConversationHealth(AT_RISK.relationship, AT_RISK.touches, NOW);
    expect(read.status).toBe("at_risk");
    expect(read.nextMoveStatus).toBe("overdue");
  });

  it("reads an untouched nurture conversation as quiet, not bad", () => {
    const read = deriveConversationHealth(QUIET.relationship, QUIET.touches, NOW);
    expect(read.status).toBe("quiet");
    expect(read.nextMoveStatus).toBe("not_needed");
  });

  it("keeps the score inside 0–100 and ordered by concern", () => {
    const scores = {
      healthy: deriveConversationHealth(HEALTHY.relationship, HEALTHY.touches, NOW).score,
      needs: deriveConversationHealth(NEEDS_ATTENTION.relationship, NEEDS_ATTENTION.touches, NOW)
        .score,
      risk: deriveConversationHealth(AT_RISK.relationship, AT_RISK.touches, NOW).score,
    };
    for (const score of Object.values(scores)) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(scores.healthy).toBeGreaterThan(scores.needs);
    expect(scores.needs).toBeGreaterThan(scores.risk);
  });

  it("always explains itself in language about the work, not the person", () => {
    for (const scenario of [HEALTHY, NEEDS_ATTENTION, AT_RISK, QUIET]) {
      const read = deriveConversationHealth(scenario.relationship, scenario.touches, NOW);
      expect(read.reasons.length).toBeGreaterThan(0);
      for (const reason of read.reasons) {
        expect(reason.trim().length).toBeGreaterThan(0);
        expect(reason).not.toMatch(/disengaged|ignoring|unresponsive|not interested/i);
      }
    }
  });
});

describe("sidebar glance and driver read the same derived state", () => {
  const scenarios = [HEALTHY, NEEDS_ATTENTION, AT_RISK, QUIET];
  const relationships = scenarios.map((s) => s.relationship);
  const touchesByRelationship = Object.fromEntries(
    scenarios.map((s) => [s.relationship.id, s.touches]),
  );
  const view = inboxView(inboxEntries(relationships, touchesByRelationship, NOW), { tab: "all" });

  it("counts every non-archived conversation exactly once across health rows", () => {
    const rows = glanceRows(view);
    const byKey = Object.fromEntries(rows.map((row) => [row.key, row.count]));
    expect(byKey['needs_attention']).toBe(view.healthCounts.needs_attention);
    expect(byKey['at_risk']).toBe(view.healthCounts.at_risk);
    expect(byKey['quiet']).toBe(view.healthCounts.quiet);
    expect(byKey['following_up']).toBe(view.tabCounts.following_up);
    const health = Object.values(view.healthCounts).reduce((sum, n) => sum + n, 0);
    expect(health).toBe(relationships.length);
  });

  it("drives toward the conversation at risk first and points at that filter", () => {
    const driver = commsDriver(view);
    expect(driver.focus).toBe("at_risk");
    expect(driver.count).toBe(view.healthCounts.at_risk);
    expect(driver.detail).toContain(String(view.healthCounts.at_risk));
  });

  it("invites a first person when Comms is genuinely empty", () => {
    const empty = inboxView([], { tab: "all" });
    const driver = commsDriver(empty);
    expect(driver.focus).toBeNull();
    expect(driver.statement).toBe("Start with one person.");
    expect(glanceRows(empty).every((row) => row.count === 0)).toBe(true);
  });
});
