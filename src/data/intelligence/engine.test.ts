/**
 * The engine's laws, held to.
 *
 * These tests exist to stop the two failures that would make the Intelligence
 * Engine untrustworthy: saying something the suite never observed, and
 * arguing with a decision a person already made.
 */

import { describe, expect, it } from "vitest";

import { emptySnapshot, type SuiteSnapshot } from "./derive";
import {
  buildEvidencePacket,
  engineRead,
  observeBusiness,
  packetFor,
  verifyHypotheses,
  withReasoning,
  type RawHypothesis,
} from "./engine";
import { MAX_HYPOTHESES } from "@/domain/intelligence-engine";

const NOW = "2026-03-01T09:00:00.000Z";
const ORG = "org-1";

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * 86_400_000).toISOString();
}

/** A business with an idle delivery room and a pipeline that stopped moving. */
function snapshot(): SuiteSnapshot {
  const base = emptySnapshot(ORG, NOW);
  return {
    ...base,
    projects: [
      {
        id: "p1",
        organizationId: ORG,
        name: "Bioptrics site",
        state: "in_flight",
        pointA: "Old site live.",
        pointB: "New site live.",
        evidence: [],
        dependencies: [],
        origin: { kind: "manual" },
        lastMovedAt: daysAgo(31),
        createdAt: daysAgo(90),
        updatedAt: daysAgo(31),
      },
    ] as SuiteSnapshot["projects"],
    relationships: [
      {
        id: "r1",
        organizationId: ORG,
        fullName: "Sam Reed",
        companyName: "Bioptrics",
        stage: "in_conversation",
        source: "manual",
        observed: [],
        inferred: [],
        decided: [],
        metadata: {},
        lastTouchAt: daysAgo(40),
        createdAt: daysAgo(120),
        updatedAt: daysAgo(40),
      },
    ] as SuiteSnapshot["relationships"],
  };
}

describe("observation stage", () => {
  it("is pure: the same snapshot always reads the same", () => {
    const first = observeBusiness(snapshot());
    const second = observeBusiness(snapshot());
    expect(second.map((row) => row.id)).toEqual(first.map((row) => row.id));
    expect(second.map((row) => row.statement)).toEqual(first.map((row) => row.statement));
  });

  it("reads an empty workspace as empty, and says only that", () => {
    const rows = observeBusiness(emptySnapshot(ORG, NOW));
    for (const row of rows) {
      expect(row.tier).toBe("observed");
      expect(row.magnitude ?? 0).toBe(0);
    }
  });

  it("never states an interpretation", () => {
    for (const row of observeBusiness(snapshot())) {
      expect(row.statement.toLowerCase()).not.toContain("because");
      expect(row.tier).not.toBe("inferred");
    }
  });
});

describe("engine read", () => {
  it("is silent rather than inventive when there is nothing to read", () => {
    const read = engineRead(emptySnapshot(ORG, NOW));
    /* An empty workspace can still be honestly described, but nothing may be
       said that is not traceable to one of those empty reads. */
    for (const hypothesis of read.hypotheses) {
      expect(hypothesis.observationRefs.length).toBeGreaterThan(0);
      for (const ref of hypothesis.observationRefs) {
        expect(read.observations.some((row) => row.id === ref)).toBe(true);
      }
    }
    expect(read.reasoned).toBe(false);
    expect(read.headline.length).toBeGreaterThan(0);
  });

  it("never produces a reading with no observation behind it", () => {
    const read = engineRead(snapshot());
    for (const hypothesis of read.hypotheses) {
      expect(hypothesis.observationRefs.length).toBeGreaterThan(0);
      for (const ref of hypothesis.observationRefs) {
        expect(read.observations.some((row) => row.id === ref)).toBe(true);
      }
    }
  });

  it("never proposes something whose result could not be observed", () => {
    const read = engineRead(snapshot());
    for (const recommendation of read.recommendations) {
      expect(recommendation.expectedSignal.length).toBeGreaterThan(0);
      expect(recommendation.expectedSignalKind.length).toBeGreaterThan(0);
      expect(recommendation.hypothesisRefs.length).toBeGreaterThan(0);
    }
  });

  it("drops a reading a person told it to stop raising", () => {
    const full = engineRead(snapshot());
    const target = full.hypotheses[0];
    expect(target).toBeDefined();
    const suppressed = engineRead(snapshot(), { suppressed: [target!.patternKey] });
    expect(suppressed.hypotheses.some((row) => row.patternKey === target!.patternKey)).toBe(false);
  });

  it("bounds how much it says", () => {
    const read = engineRead(snapshot());
    expect(read.hypotheses.length).toBeLessThanOrEqual(MAX_HYPOTHESES);
  });

  it("carries what it could not read rather than hiding it", () => {
    const withGap: SuiteSnapshot = {
      ...snapshot(),
      withheld: [{ appId: "comms", reason: "unauthorized" }],
    };
    expect(engineRead(withGap).withheld).toEqual([{ appId: "comms", reason: "unauthorized" }]);
  });
});

describe("the packet a model may reason over", () => {
  it("contains only observations, readings and stated limits", () => {
    const packet = packetFor(snapshot(), { decided: ["We paused Bioptrics on purpose."] });
    expect(packet.organizationId).toBe(ORG);
    expect(packet.decided).toContain("We paused Bioptrics on purpose.");
    for (const row of packet.observations) {
      expect(typeof row.statement).toBe("string");
      expect(row).not.toHaveProperty("evidence");
    }
  });
});

describe("verification", () => {
  const observations = observeBusiness(snapshot());
  const anyRef = observations[0]?.id ?? "";

  function verify(raw: RawHypothesis[], decided?: string[]) {
    return verifyHypotheses({
      raw,
      observations,
      now: NOW,
      ...(decided ? { decided } : {}),
    });
  }

  it("drops a claim with no observation behind it", () => {
    const result = verify([
      { claim: "The business is growing fast.", theme: "opportunity", observationRefs: ["nope"] },
    ]);
    expect(result.hypotheses).toEqual([]);
    expect(result.rejected[0]?.because).toMatch(/No observation/);
  });

  it("drops a claim that states a number nobody counted", () => {
    const result = verify([
      {
        claim: "Delivery slipped across 137 separate projects.",
        theme: "delivery",
        observationRefs: [anyRef],
      },
    ]);
    expect(result.hypotheses).toEqual([]);
    expect(result.rejected[0]?.because).toMatch(/number nobody counted/);
  });

  it("drops a claim that invents money", () => {
    const result = verify([
      { claim: "This is costing £4000 a month.", theme: "delivery", observationRefs: [anyRef] },
    ]);
    expect(result.hypotheses).toEqual([]);
  });

  it("drops a claim of certainty the evidence cannot carry", () => {
    const result = verify([
      {
        claim: "This proves the delivery process is broken.",
        theme: "delivery",
        observationRefs: [anyRef],
      },
    ]);
    expect(result.hypotheses).toEqual([]);
    expect(result.rejected[0]?.because).toMatch(/certainty/);
  });

  it("keeps a grounded reading, capped at moderate confidence", () => {
    const result = verify([
      {
        claim: "Delivery and the relationship may have gone quiet together.",
        because: "The open project and the conversation both stopped moving.",
        theme: "delivery",
        observationRefs: observations.slice(0, 2).map((row) => row.id),
      },
    ]);
    expect(result.hypotheses).toHaveLength(1);
    expect(result.hypotheses[0]?.origin).toBe("reasoned");
    expect(["low", "moderate", "unknown"]).toContain(result.hypotheses[0]?.confidence);
  });

  it("lets a person's decision silence a contradicting reading", () => {
    const claim = "Bioptrics site is not paused.";
    const result = verify(
      [{ claim, theme: "delivery", observationRefs: [anyRef] }],
      ["Bioptrics site is paused."],
    );
    expect(result.hypotheses).toEqual([]);
    expect(result.rejected[0]?.because).toMatch(/A person decided otherwise/);
  });
});

describe("folding reasoning into a read", () => {
  it("adds nothing when the model returned nothing", () => {
    const read = engineRead(snapshot());
    expect(withReasoning(read, [])).toBe(read);
  });

  it("marks the read as reasoned and keeps proposals grounded", () => {
    const read = engineRead(snapshot());
    const observations = read.observations;
    const { hypotheses } = verifyHypotheses({
      raw: [
        {
          claim: "The quiet project and the quiet conversation may be the same stall.",
          because: "Both stopped moving in the same period.",
          theme: "delivery",
          observationRefs: observations.slice(0, 2).map((row) => row.id),
        },
      ],
      observations,
      now: NOW,
    });
    const merged = withReasoning(read, hypotheses);
    expect(merged.reasoned).toBe(true);
    expect(merged.hypotheses.length).toBeLessThanOrEqual(MAX_HYPOTHESES);
    for (const recommendation of merged.recommendations) {
      for (const ref of recommendation.observationRefs) {
        expect(observations.some((row) => row.id === ref)).toBe(true);
      }
    }
  });

  it("still refuses a reading a person suppressed", () => {
    const read = engineRead(snapshot());
    const suppressedRead = { ...read, suppressed: ["engine:reasoned:delivery"] };
    const merged = withReasoning(suppressedRead, [
      {
        id: "hyp:reasoned:delivery:0",
        theme: "delivery" as const,
        claim: "Something stalled.",
        because: "Two rooms went quiet.",
        confidence: "moderate" as const,
        observationRefs: read.observations.slice(0, 1).map((row) => row.id),
        sourceApps: ["projects"],
        patternKey: "engine:reasoned:delivery",
        origin: "reasoned" as const,
        at: NOW,
      },
    ]);
    expect(merged.hypotheses.some((row) => row.origin === "reasoned")).toBe(false);
  });
});

describe("packet builder", () => {
  it("never leaks anything beyond the stated shape", () => {
    const packet = buildEvidencePacket({
      organizationId: ORG,
      now: NOW,
      observations: observeBusiness(snapshot()),
      derived: [],
      suppressed: ["engine:derived:pipeline"],
      withheld: [{ appId: "steward", reason: "not_connected" }],
    });
    expect(Object.keys(packet).sort()).toEqual(
      ["decided", "derived", "now", "observations", "organizationId", "suppressed", "withheld"].sort(),
    );
  });
});
