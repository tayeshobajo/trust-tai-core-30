import { describe, expect, it } from "vitest";

import { inboundToldUs } from "./inbound";
import type { FounderSignalPacket } from "@/domain/stated";

function packet(claims: FounderSignalPacket["claims"]): FounderSignalPacket {
  return {
    submissionId: "sub_1",
    submissionRowId: "row_1",
    statedAt: "2026-08-19T10:00:00.000Z",
    claims,
    transcript: [],
    understanding: {},
    attribution: {},
  };
}

describe("inboundToldUs", () => {
  it("prefers what they said they want", () => {
    expect(
      inboundToldUs(
        packet([
          { lane: "pains", statement: "Manual invoicing" },
          { lane: "desired_future", statement: "One system for delivery" },
        ]),
      ),
    ).toBe("One system for delivery");
  });

  it("falls back to goals, then pains", () => {
    expect(inboundToldUs(packet([{ lane: "goals", statement: "Ship in 90 days" }]))).toBe(
      "Ship in 90 days",
    );
    expect(inboundToldUs(packet([{ lane: "pains", statement: "Churn" }]))).toBe("Churn");
  });

  it("infers nothing when they said nothing", () => {
    expect(inboundToldUs(packet([]))).toBeNull();
    expect(inboundToldUs(packet([{ lane: "goals", statement: "   " }]))).toBeNull();
  });
});
