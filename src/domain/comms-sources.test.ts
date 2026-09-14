/**
 * Sources are read honestly or not at all.
 */

import { describe, expect, it } from "vitest";

import {
  classifySource,
  segmentSource,
  segmentsCoverSource,
  sourceChecksum,
  sourceCoverageNote,
} from "./comms-sources";

describe("classifying source material", () => {
  it("parses pasted text", () => {
    const source = classifySource({ text: "Hello,\r\n\r\nCan you confirm the date?" });
    expect(source.status).toBe("parsed");
    expect(source.kind).toBe("pasted_text");
    expect(source.content).toContain("confirm the date");
  });

  it("parses text and markdown files", () => {
    expect(classifySource({ filename: "notes.md", text: "# Notes" }).status).toBe("parsed");
    expect(classifySource({ filename: "thread.txt", text: "Hi there" }).kind).toBe("text_file");
  });

  it("refuses a PDF honestly instead of pretending to read it", () => {
    const source = classifySource({ filename: "proposal.pdf", mediaType: "application/pdf" });
    expect(source.status).toBe("unsupported");
    expect(source.content).toBeNull();
    expect(source.statusNote).toContain("PDF");
  });

  it("names images, spreadsheets and email exports as unread", () => {
    expect(classifySource({ filename: "shot.png" }).status).toBe("unsupported");
    expect(classifySource({ filename: "costs.xlsx" }).statusNote).toContain("spreadsheet");
    expect(classifySource({ filename: "thread.eml" }).statusNote).toContain("email");
  });

  it("distinguishes an empty paste from an unreadable file", () => {
    expect(classifySource({ text: "   " }).status).toBe("empty");
    expect(classifySource({ filename: "empty.txt", text: "" }).status).toBe("unreadable");
  });

  it("gives the same checksum to the same upload twice", () => {
    const once = classifySource({ filename: "thread.txt", text: "Same words" });
    const twice = classifySource({ filename: "thread.txt", text: "Same words" });
    expect(once.checksum).toBe(twice.checksum);
    expect(sourceChecksum("a")).not.toBe(sourceChecksum("b"));
  });
});

describe("segmentation", () => {
  it("covers a long source completely and contiguously", () => {
    const text = Array.from({ length: 200 }, (_, index) => `Paragraph ${index} of the thread.`).join(
      "\n\n",
    );
    const segments = segmentSource(text);
    expect(segments.length).toBeGreaterThan(1);
    expect(segmentsCoverSource(text, segments)).toBe(true);
    expect(segments.map((segment) => segment.text).join("")).toBe(text);
  });

  it("keeps a short source whole", () => {
    expect(segmentSource("short")).toHaveLength(1);
  });
});

describe("coverage note", () => {
  it("never claims a source was read when it was not", () => {
    const read = classifySource({ text: "Can you confirm?" });
    const unread = classifySource({ filename: "proposal.pdf" });
    expect(sourceCoverageNote([read])).toContain("read in full");
    expect(sourceCoverageNote([read, unread])).toContain("1 of 2");
    expect(sourceCoverageNote([unread])).toContain("None of the 1 sources");
    expect(sourceCoverageNote([])).toContain("No source material");
  });
});
