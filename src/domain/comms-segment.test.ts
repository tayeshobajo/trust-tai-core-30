/**
 * Segment classification: which room of the relationship workspace a person
 * belongs to. Conservative by design — graduation and explicit nurture win
 * over origin, Scout/outbound origin stays nurture, and everything else is
 * an established relationship.
 */

import { describe, expect, it } from "vitest";

import { relationshipSegment, type Relationship } from "./comms";

function relationship(part: Partial<Relationship> = {}): Relationship {
  return {
    id: "r1",
    organizationId: "org",
    fullName: "Dana Rivers",
    stage: "new",
    source: "manual",
    observed: [],
    inferred: [],
    decided: [],
    metadata: {},
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...part,
  };
}

describe("relationshipSegment", () => {
  it("keeps Scout handoffs in Nurture while they are being developed", () => {
    for (const stage of ["new", "researching", "ready_to_reach", "reached_out", "in_conversation"] as const) {
      expect(relationshipSegment(relationship({ source: "scout_handoff", stage }))).toBe("nurture");
    }
  });

  it("graduates on the same record: an established stage wins over origin", () => {
    for (const stage of ["meeting_set", "opportunity", "client"] as const) {
      expect(relationshipSegment(relationship({ source: "scout_handoff", stage }))).toBe("client");
    }
  });

  it("honours an explicit nurture stage whatever the origin", () => {
    expect(relationshipSegment(relationship({ source: "manual", stage: "nurture" }))).toBe("nurture");
  });

  it("defaults established and manual relationships to Clients", () => {
    for (const source of ["manual", "in_person", "inbound"] as const) {
      expect(relationshipSegment(relationship({ source, stage: "new" }))).toBe("client");
      expect(relationshipSegment(relationship({ source, stage: "dormant" }))).toBe("client");
    }
  });

  it("keeps a quiet Scout relationship in Nurture rather than losing it", () => {
    expect(relationshipSegment(relationship({ source: "scout_handoff", stage: "dormant" }))).toBe("nurture");
  });
});
