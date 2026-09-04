import { describe, expect, it } from "vitest";

import {
  MAX_POSTS,
  interpretRequest,
  planLine,
  readCount,
  requestBlockers,
} from "@/domain/content-request";
import { extractionPlan, kindForFile, usableAsVoice, voiceExcerpts } from "@/domain/content-source";
import type { ContentSource } from "@/domain/content-source";

function source(patch: Partial<ContentSource>): ContentSource {
  return {
    id: "csrc_1",
    organizationId: "org",
    kind: "text",
    label: "A post",
    origin: "pasted into Studio",
    mimeType: "text/plain",
    byteSize: 10,
    extractedText: "Some real writing.",
    extractionState: "extracted",
    extractionNote: "",
    provenance: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...patch,
  };
}

describe("reading a plain request", () => {
  it("reads a count from digits and from words", () => {
    expect(readCount("write 6 posts about ops")).toBe(6);
    expect(readCount("write six posts about ops")).toBe(6);
  });

  it("falls back to ten rather than guessing wildly", () => {
    expect(interpretRequest("posts about revenue operations").count).toBe(10);
  });

  it("marks a setting it inferred separately from a default", () => {
    const request = interpretRequest("10 posts for founders about fractional operations");
    expect(request.settings.audience.origin).toBe("inferred");
    expect(request.settings.audience.value.toLowerCase()).toContain("founder");
  });

  it("blocks an empty request instead of running on nothing", () => {
    expect(requestBlockers(interpretRequest(""))).not.toHaveLength(0);
  });

  it("refuses more posts than one run is allowed to write", () => {
    const request = { ...interpretRequest("posts about ops"), count: MAX_POSTS + 1 };
    expect(requestBlockers(request).join(" ")).toContain(`${MAX_POSTS}`);
  });

  it("says out loud how many sources are in play", () => {
    const line = planLine(interpretRequest("4 posts about pricing"), 0);
    expect(line).toContain("no sources selected");
  });
});

describe("reading attached material honestly", () => {
  it("does not claim to read a PDF", () => {
    const plan = extractionPlan(kindForFile({ name: "deck.pdf", type: "application/pdf" }));
    expect(plan.readable).toBe(false);
  });

  it("does not claim to transcribe audio", () => {
    const plan = extractionPlan(kindForFile({ name: "talk.mp3", type: "audio/mpeg" }));
    expect(plan.readable).toBe(false);
    expect(plan.state).toBe("not_configured");
  });

  it("only uses a source that really carries text", () => {
    expect(usableAsVoice(source({}))).toBe(true);
    expect(usableAsVoice(source({ extractedText: "   " }))).toBe(false);
    expect(usableAsVoice(source({ extractionState: "failed" }))).toBe(false);
  });

  it("bounds reference excerpts so material cannot become the article", () => {
    const long = source({ extractedText: "x".repeat(9000) });
    const [excerpt] = voiceExcerpts([long], { perSource: 100, total: 100 });
    expect(excerpt?.excerpt).toHaveLength(100);
  });
});
