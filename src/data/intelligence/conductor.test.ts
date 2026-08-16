/**
 * The Conductor's laws, held to.
 *
 * Three failures would make a command layer dangerous: inventing a number,
 * executing without a person, and answering confidently about a room it cannot
 * see. These tests exist to stop all three.
 */

import { describe, expect, it } from "vitest";

import { emptySnapshot, type SuiteSnapshot } from "./derive";
import {
  answerQuestion,
  buildOperatingPlan,
  classifyQuestion,
  detectFriction,
  findBlindSpots,
  proposeImprovements,
  readFactory,
  readVitals,
} from "./conductor";
import { FRICTION_THRESHOLD, type BusinessIntent } from "@/domain/conductor";

const NOW = "2026-03-01T09:00:00.000Z";
const ORG = "org-1";

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

function snapshot(): SuiteSnapshot {
  return emptySnapshot(ORG, NOW);
}

function revenueIntent(overrides: Partial<BusinessIntent> = {}): BusinessIntent {
  return {
    id: "intent-1",
    organizationId: ORG,
    kind: "revenue",
    label: "£300k of new revenue",
    target: 300_000,
    unit: "GBP",
    horizon: "quarter",
    because: "It funds the second delivery hire.",
    critical: true,
    decidedBy: { id: "u1", label: "Tai" },
    decidedAt: daysAgo(10),
    basis: "decided",
    ...overrides,
  };
}

describe("vital signs", () => {
  it("is pure: the same snapshot always reads the same", () => {
    const first = readVitals(snapshot());
    const second = readVitals(snapshot());
    expect(second.areas.map((area) => area.standing)).toEqual(
      first.areas.map((area) => area.standing),
    );
  });

  it("never invents a value for an uninstrumented sign", () => {
    const vitals = readVitals(snapshot());
    const readings = vitals.areas.flatMap((area) => area.readings);
    for (const reading of readings) {
      if (reading.basis === "unknown") expect(reading.value).toBeUndefined();
    }
    expect(vitals.unknownKeys).toContain("cash_runway");
  });
});

describe("factory read", () => {
  it("reports an empty business as unknown rather than falling", () => {
    const factory = readFactory(snapshot());
    expect(factory.flows.every((flow) => flow.basis === "unknown" || flow.recent === 0)).toBe(true);
  });
});

describe("blind spots", () => {
  it("names the absence of any decided outcome as the largest gap", () => {
    const snap = snapshot();
    const vitals = readVitals(snap);
    const spots = findBlindSpots({
      snapshot: snap,
      vitals,
      factory: readFactory(snap),
      intents: [],
    });
    const spot = spots.find((row) => row.key === "no_business_intent");
    expect(spot).toBeDefined();
    expect(spot!.severity).toBe("critical");
  });

  it("flags a critical goal whose own metric cannot be read", () => {
    const snap = snapshot();
    const intents = [revenueIntent()];
    const spots = findBlindSpots({
      snapshot: snap,
      vitals: readVitals(snap, intents),
      factory: readFactory(snap),
      intents,
    });
    expect(spots.some((row) => row.key.startsWith("intent_unmeasurable"))).toBe(true);
  });
});

describe("operating plan", () => {
  it("refuses to decompose a goal when a required input is unknown", () => {
    const snap = snapshot();
    const intent = revenueIntent();
    const plan = buildOperatingPlan({
      intent,
      intents: [intent],
      vitals: readVitals(snap, [intent]),
      factory: readFactory(snap),
      blindSpots: [],
      now: NOW,
    });
    expect(plan.complete).toBe(false);
    expect(plan.targets).toHaveLength(0);
    expect(plan.blockedBecause).toMatch(/close rate/i);
    expect(plan.unknowns.length).toBeGreaterThan(0);
  });

  it("refuses a goal with no number rather than guessing one", () => {
    const snap = snapshot();
    const intent = revenueIntent({ target: undefined as unknown as number });
    const plan = buildOperatingPlan({
      intent,
      intents: [intent],
      vitals: readVitals(snap),
      factory: readFactory(snap),
      blindSpots: [],
      now: NOW,
    });
    expect(plan.complete).toBe(false);
    expect(plan.targets).toHaveLength(0);
  });
});

describe("system improvement", () => {
  it("stays silent below the repetition threshold", () => {
    expect(FRICTION_THRESHOLD).toBe(3);
    expect(detectFriction(snapshot())).toHaveLength(0);
  });

  it("proposes nothing that does not require approval", () => {
    const improvements = proposeImprovements([
      {
        key: "routes_withdrawn",
        statement: "Routed work keeps being taken back.",
        occurrences: 4,
        sourceApps: ["projects"],
        firstSeen: daysAgo(20),
        lastSeen: daysAgo(1),
        evidence: [],
      },
    ]);
    expect(improvements).toHaveLength(1);
    expect(improvements[0]!.requiresApproval).toBe(true);
    expect(improvements[0]!.reversible).toBe(true);
    expect(improvements[0]!.owningApp).toBe("projects");
  });
});

describe("conversational answers", () => {
  it("routes questions to the topic a person meant", () => {
    expect(classifyQuestion("how are we doing?")).toBe("business_read");
    expect(classifyQuestion("where are we leaking work?")).toBe("leaks");
    expect(classifyQuestion("what should I do today?")).toBe("attention");
    expect(classifyQuestion("what would it take to reach 300k?")).toBe("plan");
    expect(classifyQuestion("what are we not measuring?")).toBe("gaps");
  });

  it("says it cannot plan, rather than planning, without a decided outcome", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "how do we get more revenue?" });
    expect(answer.topic).toBe("plan");
    expect(answer.plan).toBeUndefined();
    expect(answer.answer).toMatch(/no decided outcome/i);
  });

  it("never returns an action that could execute without approval", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "what should I do today?" });
    for (const action of answer.proposedActions) {
      expect(action.requiresApproval).toBe(true);
      expect(action.reversible).toBe(true);
      expect(action.willNotDo.length).toBeGreaterThan(0);
    }
  });

  it("always states its own boundary", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "how's business?" });
    expect(answer.control.willNotDo.length).toBeGreaterThan(0);
    expect(answer.control.willNotDo.join(" ")).toMatch(/without your approval/i);
  });

  it("is deterministic for the same question and snapshot", () => {
    const first = answerQuestion({ snapshot: snapshot(), question: "how's business?" });
    const second = answerQuestion({ snapshot: snapshot(), question: "how's business?" });
    expect(second.answer).toEqual(first.answer);
  });
});
