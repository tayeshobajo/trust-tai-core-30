import { describe, expect, it } from "vitest";

import type { IntelligenceCase } from "@/domain/intelligence-canon";

import { bundleForModel, citableRefs, composeRetrieval } from "./retrieval";

const NOW = "2026-08-22T10:00:00.000Z";

function correctedCase(): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId: "delivery_debt",
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "Delivery debt is accumulating.",
    humanDecision: "We paused new work.",
    decidedBy: "user-1",
    decidedAt: NOW,
    correction: "It was one bad week, not a pattern.",
    lesson: "Check the calendar before calling delivery debt.",
    diagnosisVerdict: "incorrect",
    createdAt: NOW,
  };
}

describe("composeRetrieval", () => {
  it("promotes decided statements to decided-tier evidence", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "projects",
      now: NOW,
      evidence: [],
      decided: ["We launch in September."],
    });
    expect(bundle.decided).toEqual(["We launch in September."]);
    const decidedEvidence = bundle.evidence.find((item) => item.tier === "decided");
    expect(decidedEvidence?.statement).toBe("We launch in September.");
  });

  it("folds a context packet into labelled evidence with provenance", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "projects",
      now: NOW,
      evidence: [],
      contextPacket: {
        id: "packet-1",
        title: "Website Growth Sprint",
        statements: ["Two milestones are open."],
      },
    });
    const packetEvidence = bundle.evidence.find((item) => item.id.startsWith("packet:packet-1"));
    expect(packetEvidence?.statement).toBe("Two milestones are open.");
    expect(packetEvidence?.label).toContain("Website Growth Sprint");
    expect(bundle.knowledge.some((item) => item.kind === "context_packet")).toBe(true);
  });

  it("carries withheld rooms through, never guessing at them", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "pulse",
      now: NOW,
      evidence: [],
      withheld: [{ appId: "ops", reason: "not_connected" }],
    });
    expect(bundle.withheld).toEqual([{ appId: "ops", reason: "not_connected" }]);
  });

  it("surfaces human corrections ahead of inference", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "pulse",
      now: NOW,
      evidence: [],
      cases: [correctedCase()],
    });
    expect(bundle.corrections).toHaveLength(1);
    expect(
      bundle.knowledge.some(
        (item) => item.kind === "human_correction" && item.label.includes("Check the calendar"),
      ),
    ).toBe(true);
  });

  it("composes the capability view for the asking room", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "projects",
      now: NOW,
      evidence: [],
    });
    expect(bundle.capabilities.room).toBe("projects");
    expect(bundle.capabilities.exists).toBe(true);
  });

  it("citable refs cover exactly the bundle's evidence", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "projects",
      now: NOW,
      evidence: [
        { id: "ev:a", statement: "A is true.", owningRoom: "projects", tier: "observed" },
      ],
      decided: ["B is decided."],
    });
    const refs = citableRefs(bundle);
    expect(refs.has("ev:a")).toBe(true);
    expect(refs.has("decided:0")).toBe(true);
    expect(refs.has("ev:zzz")).toBe(false);
  });
});

describe("bundleForModel", () => {
  it("serializes everything the model may see — and only that", () => {
    const bundle = composeRetrieval({
      organizationId: "org-1",
      room: "projects",
      now: NOW,
      evidence: [
        { id: "ev:a", statement: "The milestone is blocked.", owningRoom: "projects", tier: "observed" },
      ],
      decided: ["We launch in September."],
      withheld: [{ appId: "ops", reason: "not_connected" }],
    });
    const packet = bundleForModel(bundle);
    expect(packet["evidence"]).toHaveLength(2);
    expect(packet["decided"]).toEqual(["We launch in September."]);
    expect(packet["withheld"]).toEqual([{ appId: "ops", reason: "not_connected" }]);
    expect(packet["capabilities"]).toBeDefined();
    expect(JSON.stringify(packet)).not.toContain("service_role");
  });
});
