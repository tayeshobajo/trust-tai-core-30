/**
 * Comms → Roadmap handoff gate.
 *
 * The rule under test: a roadmap is only opened for a relationship that has
 * real two-way evidence behind it, the handoff carries ids rather than copies,
 * and a refusal always says what is missing.
 */

import { describe, expect, it } from "vitest";

import type { MemoryItem, Relationship, RelationshipStage } from "@/domain/comms";

import { roadmapHandoffReadiness, roadmapHandoffRef } from "./comms-roadmap-handoff";

function memory(label: string): MemoryItem {
  return {
    label,
    value: "Agreed to scope the first phase.",
    tier: "decided",
    evidence: [{ label: "Recorded by a person in Comms", kind: "human" }],
    at: "2026-08-01T00:00:00.000Z",
  };
}

function relationship(overrides: Partial<Relationship> = {}): Relationship {
  return {
    id: "rel-1",
    organizationId: "org-1",
    fullName: "Ada Rowe",
    companyName: "Rowe Studio",
    stage: "in_conversation" as RelationshipStage,
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: "2026-07-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("roadmapHandoffReadiness", () => {
  it("refuses when nothing is selected", () => {
    const result = roadmapHandoffReadiness(null);
    expect(result.ready).toBe(false);
    expect(result.because.length).toBeGreaterThan(0);
  });

  it("refuses a brand new relationship with nothing decided", () => {
    const result = roadmapHandoffReadiness(relationship({ stage: "new" }));
    expect(result.ready).toBe(false);
    expect(result.because).toMatch(/agreed/i);
  });

  it("refuses a relationship that is only ready to reach", () => {
    expect(roadmapHandoffReadiness(relationship({ stage: "ready_to_reach" })).ready).toBe(false);
  });

  it("refuses an archived relationship", () => {
    const result = roadmapHandoffReadiness(relationship({ stage: "archived" }));
    expect(result.ready).toBe(false);
    expect(result.because).toMatch(/archived/i);
  });

  it("refuses when there is no company or person named", () => {
    const result = roadmapHandoffReadiness(
      relationship({ fullName: "", companyName: "", stage: "in_conversation" }),
    );
    expect(result.ready).toBe(false);
  });

  it("allows an engaged relationship", () => {
    const result = roadmapHandoffReadiness(relationship({ stage: "in_conversation" }));
    expect(result.ready).toBe(true);
    expect(result.carries.join(" ")).toMatch(/roadmap subject, by reference/);
  });

  it("allows an early relationship once a person has decided something", () => {
    const result = roadmapHandoffReadiness(
      relationship({ stage: "researching", decided: [memory("Scope agreed")] }),
    );
    expect(result.ready).toBe(true);
    expect(result.carries.join(" ")).toMatch(/1 decision a person made/);
  });

  it("allows a touched relationship past the premature stages", () => {
    const result = roadmapHandoffReadiness(
      relationship({ stage: "nurture", lastTouchAt: "2026-08-01T00:00:00.000Z" }),
    );
    expect(result.ready).toBe(true);
  });

  it("refuses a nurture relationship with no touch and nothing decided", () => {
    expect(roadmapHandoffReadiness(relationship({ stage: "nurture" })).ready).toBe(false);
  });
});

describe("roadmapHandoffRef", () => {
  it("carries stable ids and no copied record", () => {
    const ref = roadmapHandoffRef(
      relationship({ prospectId: "prospect-9", contactId: "contact-4" }),
    );
    expect(ref).toEqual({
      kind: "relationship",
      id: "rel-1",
      label: "Rowe Studio",
      prospectId: "prospect-9",
      contactId: "contact-4",
    });
    expect(Object.keys(ref)).not.toContain("observed");
    expect(Object.keys(ref)).not.toContain("stage");
  });

  it("falls back to the person's name when there is no company", () => {
    expect(roadmapHandoffRef(relationship({ companyName: "" })).label).toBe("Ada Rowe");
  });
});
