/**
 * The Comms retrieval contract, pinned.
 *
 * Comms must reason through the shared Intelligence Runtime bundle, not a
 * bespoke string packet. These tests hold the laws that make that wiring
 * worth having: corrections ahead of inference, provenance on every line,
 * inference never promoted to fact, and unreadable sources staying unknown.
 */

import { describe, expect, it } from "vitest";

import type { IntelligenceCase } from "@/domain/intelligence-canon";

import { commsRetrievalPacket, composeCommsRetrieval } from "./comms-retrieval";

const NOW = "2026-09-09T10:00:00.000Z";

function correction(): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId: "reply_debt",
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "They went quiet because they lost interest.",
    humanDecision: "We waited.",
    decidedBy: "user-1",
    decidedAt: NOW,
    correction: "They were travelling, not disengaged.",
    lesson: "Do not read silence as disinterest for this client.",
    diagnosisVerdict: "incorrect",
    createdAt: NOW,
  };
}

function baseInput() {
  return {
    organizationId: "org-1",
    relationshipId: "rel-1",
    now: NOW,
    observedAndDecided: [
      { label: "Timing", value: "She asked about starting next month.", tier: "observed" },
      { label: "Scope", value: "We agreed on a two-phase build.", tier: "decided" },
    ],
    inferred: [{ label: "Mood", value: "She may be under budget pressure." }],
    contextLines: [
      {
        source: "project" as const,
        kind: "evidence" as const,
        text: "Project Website: status active",
      },
    ],
    trajectory: ["Work in flight: Project Website"],
  };
}

describe("composeCommsRetrieval", () => {
  it("composes the shared bundle for the comms room", () => {
    const bundle = composeCommsRetrieval(baseInput());
    expect(bundle.room).toBe("comms");
    expect(bundle.capabilities.room).toBe("comms");
    expect(bundle.organizationId).toBe("org-1");
  });

  it("carries decided memory as decided statements, not ordinary evidence", () => {
    const bundle = composeCommsRetrieval(baseInput());
    expect(bundle.decided).toEqual(["Scope: We agreed on a two-phase build."]);
    expect(bundle.evidence.some((item) => item.tier === "decided")).toBe(true);
  });

  it("keeps inference derived, so it can never be cited as fact", () => {
    const bundle = composeCommsRetrieval(baseInput());
    const inferred = bundle.evidence.find((item) => item.id.startsWith("comms:inferred:"));
    expect(inferred?.tier).toBe("derived");
    expect(inferred?.label).toContain("never stated as fact");
  });

  it("keeps a trajectory reading as interpretation, never observed", () => {
    const bundle = composeCommsRetrieval(baseInput());
    const reading = bundle.evidence.find((item) => item.id.startsWith("comms:trajectory:"));
    expect(reading?.tier).toBe("derived");
  });

  it("surfaces human corrections from the case ledger", () => {
    const bundle = composeCommsRetrieval({ ...baseInput(), cases: [correction()] });
    expect(bundle.corrections).toHaveLength(1);
  });

  it("carries an unreadable source through as withheld, never as zero", () => {
    const bundle = composeCommsRetrieval({
      ...baseInput(),
      withheld: [{ appId: "intelligence_cases", reason: "not_connected" }],
    });
    expect(bundle.withheld).toEqual([{ appId: "intelligence_cases", reason: "not_connected" }]);
    expect(bundle.corrections).toEqual([]);
  });
});

describe("commsRetrievalPacket", () => {
  it("puts human corrections ahead of everything inferred", () => {
    const packet = commsRetrievalPacket(
      composeCommsRetrieval({ ...baseInput(), cases: [correction()] }),
    );
    const keys = Object.keys(packet);
    expect(keys[0]).toBe("humanCorrections");
    const corrections = packet["humanCorrections"] as { lesson: string }[];
    expect(corrections[0]?.lesson).toContain("Do not read silence");
  });

  it("orders evidence decided, then observed, then derived", () => {
    const packet = commsRetrievalPacket(composeCommsRetrieval(baseInput()));
    const tiers = (packet["evidence"] as { tier: string }[]).map((item) => item.tier);
    const rank = { decided: 0, observed: 1, derived: 2 } as Record<string, number>;
    const ranks = tiers.map((tier) => rank[tier] ?? 3);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });

  it("serializes withheld sources so unknown stays unknown", () => {
    const packet = commsRetrievalPacket(
      composeCommsRetrieval({
        ...baseInput(),
        withheld: [{ appId: "intelligence_cases", reason: "not_connected" }],
      }),
    );
    expect(packet["withheld"]).toEqual([
      { appId: "intelligence_cases", reason: "not_connected" },
    ]);
  });

  it("names the room's real capabilities, and sends nothing", () => {
    const packet = commsRetrievalPacket(composeCommsRetrieval(baseInput()));
    expect(packet["capabilities"]).toBeDefined();
    expect(JSON.stringify(packet)).not.toContain("service_role");
  });
});
