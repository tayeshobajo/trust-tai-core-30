/**
 * The communication-judgment contract, pinned.
 *
 * These tests guard the failures seen in production: a comma-formatted name
 * must never leak into a salutation, a judgment must round-trip through a
 * draft's rationale without disturbing the staged send extras, and the
 * thread a draft reasons over must name what is actually owed.
 */

import { describe, expect, it } from "vitest";

import {
  judgmentSummaryLines,
  parseCommunicationJudgment,
  readCommunicationJudgment,
  salutationName,
  threadContextForJudgment,
  writeCommunicationJudgment,
  type CommunicationJudgment,
} from "./comms-judgment";
import { readOutgoingExtras, writeOutgoingExtras } from "./comms-outgoing";

describe("salutationName", () => {
  it("resolves surname-first exports to the given name", () => {
    expect(salutationName("Vinyard, Larry")).toBe("Larry");
    expect(salutationName("Vinyard,Larry")).toBe("Larry");
    expect(salutationName("  Smith,  Jane  ")).toBe("Jane");
    expect(salutationName("de la Cruz, Maria")).toBe("Maria");
  });

  it("uses the first token of a natural-order name", () => {
    expect(salutationName("Larry Vinyard")).toBe("Larry");
    expect(salutationName("Madonna")).toBe("Madonna");
  });

  it("never leaves a trailing comma or punctuation on the token", () => {
    expect(salutationName("Vinyard,")).toBe("Vinyard");
    expect(salutationName("Larry,")).toBe("Larry");
    expect(salutationName("O'Brien, Siobhán")).toBe("Siobhán");
  });

  it("returns empty when there is nothing safe to say", () => {
    expect(salutationName("")).toBe("");
    expect(salutationName("   ")).toBe("");
    expect(salutationName(",")).toBe("");
  });
});

const JUDGMENT: CommunicationJudgment = {
  communicationJob: "Answer their question about timing and confirm the next step.",
  relationshipRead: "Warm and active; they replied within a day and asked a real question.",
  responseObligation: "They asked whether the proposal covers phase two.",
  toneAndPosture: "Direct and brief; this relationship runs on short practical notes.",
  nextMove: { ask: true, what: "Offer two concrete times for a short call." },
  factsAllowed: ["They asked about phase two (observed, latest inbound)."],
  factsAvoid: ["Do not claim we already scoped phase two."],
  voiceEvidenceUsed: ["Short declarative sentences", "Close with Trust, Tai"],
};

describe("communication judgment on the rationale", () => {
  it("round-trips whole through write and read", () => {
    const rationale = writeCommunicationJudgment({ violations: [] }, JUDGMENT);
    expect(readCommunicationJudgment(rationale)).toEqual(JUDGMENT);
    // Existing rationale keys are preserved, not replaced.
    expect(rationale["violations"]).toEqual([]);
  });

  it("does not disturb staged send extras sharing the rationale", () => {
    const withExtras = writeOutgoingExtras({}, { cc: ["a@example.com"], bcc: [] });
    const withJudgment = writeCommunicationJudgment(withExtras, JUDGMENT);
    expect(readOutgoingExtras(withJudgment)).toEqual({ cc: ["a@example.com"], bcc: [] });
    expect(readCommunicationJudgment(withJudgment)).toEqual(JUDGMENT);
    // And writing extras later must not destroy the judgment either.
    const rewritten = writeOutgoingExtras(withJudgment, { cc: [], bcc: ["b@example.com"] });
    expect(readCommunicationJudgment(rewritten)).toEqual(JUDGMENT);
    expect(readOutgoingExtras(rewritten)).toEqual({ cc: [], bcc: ["b@example.com"] });
  });

  it("reads null when no judgment is on record", () => {
    expect(readCommunicationJudgment(null)).toBeNull();
    expect(readCommunicationJudgment({})).toBeNull();
    expect(readCommunicationJudgment({ communication_judgment: "noise" })).toBeNull();
  });

  it("refuses a judgment without its core read", () => {
    expect(parseCommunicationJudgment({})).toBeNull();
    expect(parseCommunicationJudgment({ communicationJob: "Only a job." })).toBeNull();
    expect(parseCommunicationJudgment("not an object")).toBeNull();
  });

  it("normalizes a string nextMove and drops an empty ask", () => {
    const parsed = parseCommunicationJudgment({
      ...JUDGMENT,
      nextMove: "Offer two times.",
    });
    expect(parsed?.nextMove).toEqual({ ask: true, what: "Offer two times." });
    const noAsk = parseCommunicationJudgment({
      ...JUDGMENT,
      nextMove: { ask: true, what: "" },
    });
    expect(noAsk?.nextMove).toEqual({ ask: false, what: "" });
  });
});

describe("judgmentSummaryLines", () => {
  it("keeps the read to three short lines", () => {
    const lines = judgmentSummaryLines(JUDGMENT);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(JUDGMENT.communicationJob);
    expect(lines[2]).toContain(JUDGMENT.nextMove.what);
  });

  it("says plainly when there is no ask", () => {
    const lines = judgmentSummaryLines({
      ...JUDGMENT,
      nextMove: { ask: false, what: "" },
    });
    expect(lines[2]).toBe("No ask. The message stands on its own.");
  });
});

describe("threadContextForJudgment", () => {
  const message = (
    direction: "inbound" | "outbound",
    occurredAt: string,
    text: string,
    subject?: string,
  ) => ({ direction, occurredAt, bodyText: text, ...(subject ? { subject } : {}) });

  it("returns the recent slice oldest-to-newest with sides marked", () => {
    const entries = threadContextForJudgment([
      message("outbound", "2026-08-01T10:00:00Z", "First note.", "Hello"),
      message("inbound", "2026-08-02T10:00:00Z", "Their reply.", "Re: Hello"),
      message("outbound", "2026-08-03T10:00:00Z", "Our answer."),
      message("inbound", "2026-08-04T10:00:00Z", "Their latest question."),
    ]);
    expect(entries).toHaveLength(4);
    expect(entries[0]!.subject).toBe("Hello");
    expect(entries[1]!.latestForSide).toBe(false);
    expect(entries[2]!.latestForSide).toBe(true);
    expect(entries[3]!.latestForSide).toBe(true);
  });

  it("never drafts blind: an empty thread stays empty, and nothing is invented", () => {
    expect(threadContextForJudgment([])).toEqual([]);
  });

  it("bounds the window and trims long bodies without dropping short ones", () => {
    const many = Array.from({ length: 12 }, (_, index) =>
      message("inbound", `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00Z`, `Note ${index}`),
    );
    const entries = threadContextForJudgment(many);
    expect(entries).toHaveLength(8);
    expect(entries[0]!.text).toBe("Note 4");

    const long = threadContextForJudgment([
      message("inbound", "2026-08-01T10:00:00Z", "x".repeat(2000)),
      message("inbound", "2026-08-02T10:00:00Z", "short"),
    ]);
    expect(long[0]!.text.length).toBeLessThanOrEqual(901);
    expect(long[0]!.text.endsWith("…")).toBe(true);
    expect(long[1]!.text).toBe("short");
  });

  it("falls back to the snippet when no full body is stored", () => {
    const entries = threadContextForJudgment([
      { direction: "inbound", occurredAt: "2026-08-01T10:00:00Z", snippet: "A snippet." },
    ]);
    expect(entries[0]!.text).toBe("A snippet.");
  });
});
