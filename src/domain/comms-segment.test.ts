/**
 * Segment classification: which room of the relationship workspace a person
 * belongs to. Classification follows current relationship reality, not the
 * door the person entered through, established evidence (client link,
 * graduated stage, established intent) wins over development evidence
 * (nurture stage, prospect intent, Scout provenance, early stage), and the
 * fallback keeps legacy established/manual rows visible in Clients.
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
  it("classifies by reality, not source: new + in_person is Nurture", () => {
    // Lorena: a prospect we met in person, early days, she is being
    // developed, not an established client.
    expect(relationshipSegment(relationship({ source: "in_person", stage: "new" }))).toBe(
      "nurture",
    );
  });

  it("classifies new + inbound as Nurture when there is no client evidence", () => {
    expect(relationshipSegment(relationship({ source: "inbound", stage: "new" }))).toBe("nurture");
    expect(relationshipSegment(relationship({ source: "inbound", stage: "researching" }))).toBe(
      "nurture",
    );
  });

  it("keeps Scout handoffs in Nurture while they are being developed", () => {
    for (const stage of [
      "new",
      "researching",
      "ready_to_reach",
      "reached_out",
      "in_conversation",
    ] as const) {
      expect(relationshipSegment(relationship({ source: "scout_handoff", stage }))).toBe(
        "nurture",
      );
    }
  });

  it("treats in_conversation as contextual: prospect evidence means Nurture", () => {
    expect(
      relationshipSegment(relationship({ stage: "in_conversation", prospectId: "p1" })),
    ).toBe("nurture");
    expect(
      relationshipSegment(relationship({ stage: "in_conversation", source: "scout_handoff" })),
    ).toBe("nurture");
    expect(
      relationshipSegment(
        relationship({ stage: "in_conversation", metadata: { intent: "prospect" } }),
      ),
    ).toBe("nurture");
  });

  it("treats in_conversation as contextual: client evidence means Clients", () => {
    expect(
      relationshipSegment(relationship({ stage: "in_conversation", clientId: "c1" })),
    ).toBe("client");
    expect(
      relationshipSegment(
        relationship({ stage: "in_conversation", metadata: { intent: "active_client" } }),
      ),
    ).toBe("client");
  });

  it("graduates on the same record: an established stage wins over origin", () => {
    for (const stage of ["meeting_set", "opportunity", "client"] as const) {
      expect(relationshipSegment(relationship({ source: "scout_handoff", stage }))).toBe("client");
    }
  });

  it("keeps a linked client in Clients even at an early or quiet stage", () => {
    expect(relationshipSegment(relationship({ clientId: "c1", stage: "new" }))).toBe("client");
    expect(relationshipSegment(relationship({ clientId: "c1", stage: "dormant" }))).toBe("client");
  });

  it("honours an explicit nurture stage whatever the origin", () => {
    expect(relationshipSegment(relationship({ source: "manual", stage: "nurture" }))).toBe(
      "nurture",
    );
  });

  it("honours an explicit prospect intent as development evidence", () => {
    expect(
      relationshipSegment(relationship({ stage: "in_conversation", metadata: { intent: "prospect" } })),
    ).toBe("nurture");
  });

  it("keeps a quiet Scout relationship in Nurture rather than losing it", () => {
    expect(relationshipSegment(relationship({ source: "scout_handoff", stage: "dormant" }))).toBe(
      "nurture",
    );
    expect(relationshipSegment(relationship({ stage: "dormant", prospectId: "p1" }))).toBe(
      "nurture",
    );
  });

  it("keeps a dormant known client in Clients", () => {
    expect(relationshipSegment(relationship({ stage: "dormant", clientId: "c1" }))).toBe("client");
    expect(
      relationshipSegment(relationship({ stage: "dormant", metadata: { intent: "past_client" } })),
    ).toBe("client");
  });

  it("falls back to Clients for legacy established/manual rows with no development evidence", () => {
    // The safety net: in_conversation and dormant are contextual, so a legacy
    // row with no prospect evidence stays visible rather than vanishing.
    for (const source of ["manual", "in_person", "inbound"] as const) {
      expect(relationshipSegment(relationship({ source, stage: "in_conversation" }))).toBe(
        "client",
      );
      expect(relationshipSegment(relationship({ source, stage: "dormant" }))).toBe("client");
    }
  });

  it("graduation never changes identity: only the stage moves", () => {
    const before = relationship({ id: "r9", source: "scout_handoff", stage: "in_conversation" });
    const after = {...before, stage: "client" as const };
    expect(relationshipSegment(before)).toBe("nurture");
    expect(relationshipSegment(after)).toBe("client");
    expect(after.id).toBe(before.id);
  });
});
