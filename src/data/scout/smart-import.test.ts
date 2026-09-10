import { describe, expect, it } from "vitest";

import { readLink, stageExtracted, verifyExtraction } from "./smart-import";
import type { ExtractedCompany } from "@/domain/scout-smart-import";

const SOURCE = [
  "Our Q3 shortlist. Northfield Dental (northfielddental.com) reopened two sites.",
  "Smith, Jones & Co are still deciding.",
].join("\n");

function extracted(over: Partial<ExtractedCompany> = {}): ExtractedCompany {
  return {
    name: "Northfield Dental",
    websiteUrl: "https://northfielddental.com",
    websiteConfidence: "observed",
    note: null,
    because: "Named in the source.",
    excerpt: "Northfield Dental (northfielddental.com)",
    ...over,
  };
}

describe("smart import links", () => {
  it("reads a public Google Sheet through its export address", () => {
    const read = readLink("https://docs.google.com/spreadsheets/d/abc123/edit#gid=0");
    expect(read.readable).toBe(true);
    if (read.readable) {
      expect(read.kind).toBe("google_sheet");
      expect(read.url).toContain("export?format=csv");
    }
  });

  it("refuses a Drive file in words rather than half reading it", () => {
    const read = readLink("https://drive.google.com/file/d/xyz/view");
    expect(read.readable).toBe(false);
    if (!read.readable) expect(read.because).toMatch(/cannot be read yet/i);
  });

  it("refuses something that is not a link", () => {
    expect(readLink("my spreadsheet").readable).toBe(false);
  });
});

describe("smart import grounding", () => {
  it("keeps a company whose excerpt is verbatim in the source", () => {
    const verified = verifyExtraction({ companies: [extracted()] }, SOURCE);
    expect(verified.companies).toHaveLength(1);
    expect(verified.dropped).toHaveLength(0);
  });

  it("drops an invented company that cannot be pointed at", () => {
    const verified = verifyExtraction(
      { companies: [extracted({ name: "Ghost Dental", excerpt: "Ghost Dental, ghost.com" })] },
      SOURCE,
    );
    expect(verified.companies).toHaveLength(0);
    expect(verified.dropped[0]?.because).toMatch(/could not point at this/i);
  });

  it("marks a website inferred when it is not literally in the source", () => {
    const verified = verifyExtraction(
      {
        companies: [
          extracted({
            name: "Smith, Jones & Co",
            websiteUrl: "smithjones.co.uk",
            excerpt: "Smith, Jones & Co are still deciding",
          }),
        ],
      },
      SOURCE,
    );
    expect(verified.companies[0]?.websiteConfidence).toBe("inferred");
  });
});

describe("smart import staging", () => {
  it("stages a board duplicate as a duplicate and never as savable", () => {
    const staged = stageExtracted(
      [extracted()],
      [{ name: "Northfield Dental", websiteUrl: "https://northfielddental.com" }],
      { kind: "file", label: "list.csv" },
    );
    expect(staged[0]?.state).toBe("duplicate");
    expect(staged[0]?.keep).toBe(false);
  });

  it("stages a new company as keepable, carrying its source excerpt", () => {
    const staged = stageExtracted([extracted()], [], { kind: "text", label: "the pasted text" });
    expect(staged[0]?.state).toBe("new");
    expect(staged[0]?.keep).toBe(true);
    expect(staged[0]?.extraction?.excerpt).toContain("northfielddental.com");
  });
});
