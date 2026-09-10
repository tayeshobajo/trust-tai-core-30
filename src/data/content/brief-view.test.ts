import { describe, expect, it } from "vitest";

import {
  applyBriefEdits,
  briefGaps,
  briefIsKeepable,
  displayTitle,
  spineRows,
  structureNote,
} from "./brief-view";
import type { ContentBrief } from "@/domain/content-brief";

function brief(overrides: Partial<ContentBrief> = {}): ContentBrief {
  return {
    id: "",
    organizationId: "org",
    coreIdea: "What advisory actually changes.",
    angle: "Written by the person doing the work.",
    audienceLanguage: ["transformational advisory"],
    titleCandidates: [
      {
        title: "The advisory that changes the operating system",
        familiarityAnchor: "advisory",
        freshTurn: "operating system",
        intentFit: "They wanted to know what changes.",
      },
    ],
    chosenTitle: null,
    opening: { firstParagraph: "Most advisory ends in a deck.", whyItEarnsParagraphTwo: "It names the loss." },
    spine: {
      end: "They run the business differently.",
      beginning: "A founder rereads the same deck.",
      middle: ["Where advice stops", "What an operating system does"],
      landing: "One decision to make this week.",
      structureChoice: "end_first",
      whyThisStructure: "",
    },
    seo: { primaryLanguage: ["transformational advisory"], intent: "understand", evidenceRefs: [], overlapRisk: null },
    imagePlan: { images: [], because: "No image earns its place in this story." },
    sourceOpportunityId: "query_cluster:advisory:2026-08-01",
    state: "draft",
    ...overrides,
  };
}

describe("displayTitle", () => {
  it("prefers the human choice over the first candidate", () => {
    expect(displayTitle(brief({ chosenTitle: "My own title" }))).toBe("My own title");
    expect(displayTitle(brief())).toBe("The advisory that changes the operating system");
  });
});

describe("applyBriefEdits", () => {
  it("lets a person's wording replace what Studio drafted", () => {
    const edited = applyBriefEdits(brief(), {
      firstParagraph: "  Most advisory ends in a slide nobody opens again.  ",
      end: "They stop buying decks.",
    });
    expect(edited.opening.firstParagraph).toBe("Most advisory ends in a slide nobody opens again.");
    expect(edited.spine.end).toBe("They stop buying decks.");
  });

  it("treats a blank edit as no edit", () => {
    const edited = applyBriefEdits(brief(), { firstParagraph: "   ", coreIdea: "" });
    expect(edited.opening.firstParagraph).toBe("Most advisory ends in a deck.");
    expect(edited.coreIdea).toBe("What advisory actually changes.");
  });

  it("keeps the drafted middle when none was edited, and drops empty lines when it was", () => {
    expect(applyBriefEdits(brief(), {}).spine.middle).toHaveLength(2);
    expect(applyBriefEdits(brief(), { middle: ["One", "  ", "Two"] }).spine.middle).toEqual([
      "One",
      "Two",
    ]);
  });

  it("never mutates the brief it was given", () => {
    const original = brief();
    applyBriefEdits(original, { end: "Something else" });
    expect(original.spine.end).toBe("They run the business differently.");
  });
});

describe("briefGaps", () => {
  it("is keepable when it has a title, an opening and an end", () => {
    expect(briefGaps(brief())).toEqual([]);
    expect(briefIsKeepable(brief())).toBe(true);
  });

  it("names what is missing instead of keeping a hollow brief", () => {
    const hollow = brief({
      titleCandidates: [],
      opening: { firstParagraph: "", whyItEarnsParagraphTwo: "" },
      spine: { ...brief().spine, end: "" },
    });
    expect(briefGaps(hollow)).toEqual(["a title", "an opening paragraph", "where the reader ends up"]);
    expect(briefIsKeepable(hollow)).toBe(false);
  });
});

describe("spineRows", () => {
  it("reads beginning first and still records that the end was written first", () => {
    const rows = spineRows(brief());
    expect(rows.map((row) => row.label)).toEqual([
      "Beginning",
      "Middle 1",
      "Middle 2",
      "Landing",
      "The end, written first",
    ]);
    expect(rows[1]).toMatchObject({ field: "middle", index: 0 });
  });
});

describe("structureNote", () => {
  it("says the default plainly", () => {
    expect(structureNote(brief())).toContain("end first");
  });

  it("shows the written reason when the shape is not the default", () => {
    const other = brief({
      spine: { ...brief().spine, structureChoice: "other", whyThisStructure: "It is a walkthrough." },
    });
    expect(structureNote(other)).toBe("It is a walkthrough.");
  });
});
