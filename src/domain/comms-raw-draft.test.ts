/**
 * Saving what a person wrote, without pretending a model wrote it.
 */

import { describe, expect, it } from "vitest";

import { rawWritingDraft } from "./comms-raw-draft";

describe("a draft made of someone's own words", () => {
  it("keeps the words exactly, minus the whitespace around them", () => {
    const draft = rawWritingDraft({ register: "follow_up", text: "  Thanks Dana. Friday works.  " });
    expect(draft.body).toBe("Thanks Dana. Friday works.");
    expect(draft.register).toBe("follow_up");
  });

  it("claims no judgment, no grounding and no evidence, because none was made", () => {
    const draft = rawWritingDraft({ register: "logistics", text: "Sending the file today." });
    expect(draft.evidence).toEqual([]);
    expect(draft.rationale).toMatchObject({ writtenBy: "person", generated: false });
    expect(draft.rationale).not.toHaveProperty("judgment");
    expect(draft.rationale).not.toHaveProperty("violations");
  });

  it("waits at the same human boundary as any other draft", () => {
    expect(rawWritingDraft({ register: "follow_up", text: "Hi" }).reviewState).toBe(
      "needs_human_review",
    );
  });

  it("names itself from the first line, shortened, or from the subject", () => {
    expect(rawWritingDraft({ register: "follow_up", text: "\n\nFriday works\nsee you" }).intent).toBe(
      "Friday works",
    );
    expect(
      rawWritingDraft({ register: "follow_up", text: "body", subject: "  Contract  " }),
    ).toMatchObject({ intent: "Contract", subject: "Contract" });
    expect(rawWritingDraft({ register: "follow_up", text: "x".repeat(200) }).intent).toHaveLength(72);
  });

  it("refuses to save nothing", () => {
    expect(() => rawWritingDraft({ register: "follow_up", text: "   " })).toThrow(
      /nothing written/i,
    );
  });
});
