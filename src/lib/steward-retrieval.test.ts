/**
 * The Steward retrieval contract, pinned.
 *
 * Steward must reason through the shared Intelligence Runtime bundle, not a
 * bespoke memory object. These tests hold the laws that make that wiring worth
 * having: corrections ahead of inference, provenance on every line, inference
 * never promoted to fact, canonical people carried through, and unreadable
 * sources staying unknown.
 */

import { describe, expect, it, vi } from "vitest";

import type { IntelligenceCase } from "@/domain/intelligence-canon";
import type { MemoryContext } from "@/domain/steward-semantic";
import type { NormalizedConversation } from "@/domain/steward";

import { composeStewardRetrieval, stewardRetrievalPacket } from "./steward-retrieval";
import { interpretConversation } from "./steward-interpret.server";

const NOW = "2026-09-09T10:00:00.000Z";

function correction(): IntelligenceCase {
  return {
    id: "case-1",
    organizationId: "org-1",
    patternId: "silent_owner",
    patternVersion: 1,
    entities: [],
    evidenceRefs: [],
    hypothesis: "Nobody owns the migration.",
    humanDecision: "Priya owns it.",
    decidedBy: "user-1",
    decidedAt: NOW,
    correction: "Priya owns the migration, not Sam.",
    lesson: "Ownership follows the role, not who spoke last.",
    diagnosisVerdict: "incorrect",
    createdAt: NOW,
  };
}

function memory(overrides: Partial<MemoryContext> = {}): MemoryContext {
  return {
    available: true,
    because: "Steward knows 2 people here.",
    openCommitments: [
      { id: "c-1", statement: "Send the migration plan", ownerName: "Priya", status: "open" },
    ],
    people: [{ name: "Priya Rao", title: "Delivery lead" }],
    projects: [{ id: "p-1", label: "Migration" }],
    decided: ["Priya owns the migration."],
    inferred: ["Sam may be overloaded."],
    ...overrides,
  };
}

describe("composeStewardRetrieval", () => {
  it("composes the shared bundle for the steward room", () => {
    const bundle = composeStewardRetrieval({ organizationId: "org-1", now: NOW, memory: memory() });
    expect(bundle.room).toBe("steward");
    expect(bundle.organizationId).toBe("org-1");
    expect(bundle.capabilities).toBeTruthy();
  });

  it("keeps canonical people and commitments observed, and inference derived", () => {
    const bundle = composeStewardRetrieval({ organizationId: "org-1", now: NOW, memory: memory() });
    const person = bundle.evidence.find((entry) => entry.id === "steward:person:0");
    const inferred = bundle.evidence.find((entry) => entry.id === "steward:inferred:0");
    expect(person?.tier).toBe("observed");
    expect(person?.statement).toContain("Priya Rao");
    expect(inferred?.tier).toBe("derived");
    /* Inference is never promoted to observed or decided. */
    expect(bundle.decided).toEqual(["Priya owns the migration."]);
    expect(bundle.decided).not.toContain("Sam may be overloaded.");
  });

  it("keeps unreadable memory withheld rather than empty", () => {
    const bundle = composeStewardRetrieval({
      organizationId: "org-1",
      now: NOW,
      memory: memory({
        available: false,
        because: "Canonical memory could not be read.",
        people: [],
        projects: [],
        openCommitments: [],
      }),
      withheld: [{ appId: "intelligence_cases", reason: "not_connected" }],
    });
    const ids = bundle.withheld.map((row) => row.appId);
    expect(ids).toContain("steward_canonical_memory");
    expect(ids).toContain("intelligence_cases");
  });
});

describe("stewardRetrievalPacket", () => {
  it("puts human corrections ahead of inference and orders evidence by provenance", () => {
    const packet = stewardRetrievalPacket(
      composeStewardRetrieval({
        organizationId: "org-1",
        now: NOW,
        memory: memory(),
        cases: [correction()],
      }),
    );
    const keys = Object.keys(packet);
    expect(keys[0]).toBe("humanCorrections");
    expect((packet["humanCorrections"] as { correction: string }[])[0]?.correction).toContain(
      "Priya owns the migration",
    );
    const tiers = (packet["evidence"] as { tier: string }[]).map((entry) => entry.tier);
    expect(tiers.indexOf("decided")).toBeLessThan(tiers.lastIndexOf("derived"));
  });

  it("reports no corrections honestly rather than inventing them", () => {
    const packet = stewardRetrievalPacket(
      composeStewardRetrieval({ organizationId: "org-1", now: NOW, memory: memory() }),
    );
    expect(packet["humanCorrections"]).toEqual([]);
  });
});

/* ------------------------------------------------------------- injection */

function conversation(): NormalizedConversation {
  return {
    sourceRef: { provider: "fixture", url: "https://example.test/call" },
    title: "Migration sync",
    occurredAt: NOW,
    participants: [{ name: "Priya Rao" }],
    segments: [
      { index: 0, speaker: "Priya Rao", at: "00:00:10", text: "I will send the migration plan." },
    ],
    sourceActionItems: [],
  };
}

describe("interpretConversation", () => {
  it("hands the model the shared retrieval bundle, not only the bespoke memory object", async () => {
    const callModel = vi.fn(async () => ({
      raw: JSON.stringify({ interpretations: [] }),
      provider: "fake",
      model: "fake-1",
    }));

    await interpretConversation(
      {
        conversation: conversation(),
        memory: memory(),
        commitments: [],
        organizationId: "org-1",
        cases: [correction()],
      },
      callModel as never,
    );

    expect(callModel).toHaveBeenCalled();
    const call = (
      callModel.mock.calls as unknown as { instructions: string; input: string }[][]
    )[0]?.[0] as {
      instructions: string;
      input: string;
    };
    const sent = JSON.parse(call.input) as { retrieval: Record<string, unknown> };
    expect(sent.retrieval).toBeTruthy();
    expect(sent.retrieval["room"]).toBe("steward");
    expect((sent.retrieval["humanCorrections"] as unknown[]).length).toBe(1);
    expect(call.instructions).toContain("retrieval.humanCorrections");
  });

  it("stays honest when the provider fails, promoting no deterministic output", async () => {
    const callModel = vi.fn(async () => {
      throw new Error("provider down");
    });
    await expect(
      interpretConversation(
        { conversation: conversation(), memory: memory(), commitments: [] },
        callModel as never,
      ),
    ).rejects.toThrow(/could not interpret/i);
  });
});
