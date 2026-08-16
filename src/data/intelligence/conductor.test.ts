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
import {
  FACTUAL_BASES,
  FRICTION_THRESHOLD,
  type BusinessIntent,
} from "@/domain/conductor";
import type { ActivityEvent } from "@/domain/activity";
import { vitalReading } from "./conductor";

/** The rooms that may own work. The Conductor is not one of them. */
const SUITE_ROOM_IDS = ["scout", "comms", "roadmap", "projects", "ops", "studio", "steward"];

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

/* ------------------------------------------------------------------ *
 * The Conductor's laws, part two: truth classes, causality, ownership.
 * ------------------------------------------------------------------ */

function event(name: string, at: string, id: string): ActivityEvent {
  return {
    id,
    organizationId: ORG,
    name: name as ActivityEvent["name"],
    subject: { type: "prospect", id: `subject-${id}` },
    summary: name,
    provenance: {
      appId: "scout",
      actor: { type: "system", id: "test" },
      observedAt: at,
    },
    occurredAt: at,
  };
}

describe("truth classes", () => {
  it("keeps observed, decided, inferred and unknown distinct in one plan", () => {
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
    /* The decided outcome survives even when the plan cannot be completed. */
    const outcome = plan.assumptions.find((row) => row.key === "outcome");
    expect(outcome?.basis).toBe("decided");
    /* Unknown inputs are stated as unknown and carry no value. */
    for (const row of plan.assumptions.filter((a) => a.basis === "unknown")) {
      expect(row.value).toBeUndefined();
    }
    /* Nothing was inferred on top of an unknown. */
    expect(plan.targets.filter((t) => t.basis === "inferred")).toHaveLength(0);
  });

  it("never labels a Conductor suggestion as a fact", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "what should I do today?" });
    for (const action of answer.proposedActions) {
      expect(FACTUAL_BASES).not.toContain("recommended");
      expect(action.requiresApproval).toBe(true);
    }
  });
});

describe("human authority", () => {
  it("lets a decided target darken a reading but never overwrite the count", () => {
    const snap = snapshot();
    snap.events = [
      event("prospect.qualified", daysAgo(2), "e1"),
      event("prospect.qualified", daysAgo(3), "e2"),
    ];
    const intent: BusinessIntent = {
      ...revenueIntent(),
      kind: "qualified_pipeline",
      target: 40,
      unit: "companies",
    };
    const plain = readVitals(snap);
    const withGoal = readVitals(snap, [intent]);
    const key = "qualified_companies";
    const before = vitalReading(plain, key);
    const after = vitalReading(withGoal, key);
    if (before && after && before.basis !== "unknown") {
      expect(after.value).toEqual(before.value);
      expect(after.target).toBe(40);
    }
    expect(withGoal.organizationId).toBe(ORG);
  });
});

describe("causal reasoning", () => {
  it("warns downstream from an upstream fall before the outcome moves", () => {
    const snap = snapshot();
    snap.events = [
      /* Prior window busy, recent window empty: a real fall at the top. */
      event("prospect.discovered", daysAgo(30), "p1"),
      event("prospect.discovered", daysAgo(31), "p2"),
      event("prospect.discovered", daysAgo(32), "p3"),
      event("prospect.discovered", daysAgo(33), "p4"),
      /* Downstream still ticking along, so it has not felt it yet. */
      event("project.completed", daysAgo(2), "d1"),
      event("project.completed", daysAgo(25), "d2"),
    ];
    const factory = readFactory(snap);
    const warning = factory.warnings.find((row) => row.nodeId === "demand");
    expect(warning).toBeDefined();
    expect(warning!.downstreamIds.length).toBeGreaterThan(0);
    expect(warning!.expectedByDays).toBeGreaterThan(0);
    expect(warning!.evidence.length).toBeGreaterThan(0);
  });
});

describe("ownership and isolation", () => {
  it("routes every proposed action to a room that owns the work", () => {
    const snap = snapshot();
    snap.projects = [];
    const answer = answerQuestion({ snapshot: snap, question: "where are we leaking work?" });
    for (const action of answer.proposedActions) {
      expect(SUITE_ROOM_IDS).toContain(action.owningApp);
    }
    if (answer.actionGraph) {
      expect(answer.actionGraph.requiresApproval).toBe(true);
      for (const step of answer.actionGraph.steps) {
        expect(SUITE_ROOM_IDS).toContain(step.owningApp);
      }
    }
  });

  it("answers only about the organization it was handed", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "how's business?" });
    expect(answer.organizationId).toBe(ORG);
    expect(answer.vitals.organizationId).toBe(ORG);
    expect(answer.factory.organizationId).toBe(ORG);
  });

  it("carries evidence and names what it cannot see", () => {
    const answer = answerQuestion({ snapshot: snapshot(), question: "how's business?" });
    expect(answer.evidence.length).toBeGreaterThan(0);
    expect(answer.unknowns.length).toBeGreaterThan(0);
    for (const spot of answer.unknowns) expect(spot.howToInstrument).toBeTruthy();
  });
});
