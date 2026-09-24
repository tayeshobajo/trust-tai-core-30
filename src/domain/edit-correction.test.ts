import { describe, expect, it } from "vitest";

import { buildEditCorrection, correctionLesson } from "./edit-correction";

const SITUATION = {
  register: "scout_intro",
  intent: "introduce",
  decideAction: "begin_conversation",
  worldCardSummary: "building:2 cares:1 changes:1 outgrew:1 why:1 unknowns:1",
};

describe("buildEditCorrection", () => {
  it("captures a correction when the approved words differ from the drafted words", () => {
    const record = buildEditCorrection({
      situation: SITUATION,
      draftedBody: "Hi Dana. I saw the second clinic news. We build websites. Interested?",
      approvedBody:
        "Hi Dana. I saw the second clinic news. Congrats. If booking ever feels like the bottleneck, happy to share what we did for a practice in a similar spot. No pressure either way.",
      decision: "approved",
      now: "2026-09-24T00:00:00.000Z",
    });
    expect(record).not.toBeNull();
    expect(record?.decision).toBe("approved_with_edits");
    expect(record?.learned_principle).toBeNull();
    expect(record?.diff_summary).toMatch(/sentence/);
    expect(record?.approved_excerpt).toContain("No pressure");
    expect(correctionLesson(record!)).toContain("edited");
  });

  it("returns null when the approval matches the draft exactly: agreement is not a correction", () => {
    const body = "Hi Dana. Short and true.";
    expect(
      buildEditCorrection({
        situation: SITUATION,
        draftedBody: body,
        approvedBody: body,
        decision: "approved",
      }),
    ).toBeNull();
  });

  it("captures a discard as a correction with no approved words", () => {
    const record = buildEditCorrection({
      situation: SITUATION,
      draftedBody: "Hi Dana. Buy a website from us today.",
      approvedBody: null,
      decision: "discarded",
      now: "2026-09-24T00:00:00.000Z",
    });
    expect(record?.decision).toBe("discarded");
    expect(record?.approved_excerpt).toBeNull();
    expect(correctionLesson(record!)).toContain("discarded");
  });

  it("returns null when there was no drafted body to learn from", () => {
    expect(
      buildEditCorrection({
        situation: SITUATION,
        draftedBody: "  ",
        approvedBody: "Anything",
        decision: "approved",
      }),
    ).toBeNull();
  });
});
