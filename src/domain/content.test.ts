/**
 * The laws the content room must not break.
 *
 * These are the ones that would cost something real: publishing what nobody
 * approved, publishing twice, or calling a post verified because the run said
 * so rather than because the live page said so.
 */

import { describe, expect, it } from "vitest";

import {
  assessItem,
  canItemTransition,
  isItemAuthorised,
  publishKeyFor,
  publishRefusal,
  readBatch,
  verifyPublished,
  wordCount,
  type ContentItem,
} from "./content";

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "citm_1",
    organizationId: "org_1",
    batchId: "cbat_1",
    position: 0,
    slug: "operating-system-for-founders",
    title: "An operating system for founders",
    angle: "Why the work stalls without one.",
    readerJob: "Decide whether to build one.",
    brief: { outline: ["a", "b"], mustCover: [], sources: [] },
    draftMarkdown: Array.from({ length: 800 }, (_, index) => `word${index}`).join(" "),
    hitRationale: "It answers the question the reader actually arrived with.",
    seo: {
      title: "An operating system for founders",
      metaDescription: "What it is, and when it is worth building one.",
      slug: "operating-system-for-founders",
    },
    internalLinks: [],
    cta: { readerNeed: "Keep reading", offer: "The next piece", line: "Read on." },
    taxonomy: { category: "Operations", tags: ["operations"] },
    image: { state: "ready", brief: "", altText: "A quiet desk", assetUrl: "x", provider: "p" },
    generation: { provider: "lovable", model: "gemini", at: new Date().toISOString() },
    state: "ready",
    exceptionReasons: [],
    failureReason: null,
    publishKey: publishKeyFor("cbat_1", "operating-system-for-founders"),
    publish: { state: "none" },
    verification: { state: "unverified", because: "Not checked yet." },
    externalPostId: null,
    canonicalUrl: null,
    publishedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as ContentItem;
}

describe("content states", () => {
  it("never treats a prepared post as authorised", () => {
    expect(isItemAuthorised("ready")).toBe(false);
    expect(isItemAuthorised("exception")).toBe(false);
    expect(isItemAuthorised("approved")).toBe(true);
  });

  it("keeps approved, queued, published and verified apart", () => {
    expect(canItemTransition("approved", "published")).toBe(false);
    expect(canItemTransition("approved", "queued")).toBe(true);
    expect(canItemTransition("queued", "publishing")).toBe(true);
    expect(canItemTransition("published", "verified")).toBe(true);
    expect(canItemTransition("ready", "published")).toBe(false);
  });

  it("refuses to publish what no one approved, and refuses to publish twice", () => {
    expect(publishRefusal(item({ state: "ready" }))?.because).toMatch(/approved/i);
    expect(publishRefusal(item({ state: "approved" }))?.because).toMatch(/not queued/i);
    expect(publishRefusal(item({ state: "published" }))?.because).toMatch(/already live/i);
    expect(publishRefusal(item({ state: "queued" }))).toBeNull();
  });

  it("gives one post one stable publish key", () => {
    expect(publishKeyFor("cbat_1", "a-slug")).toBe(publishKeyFor("cbat_1", "a-slug"));
    expect(publishKeyFor("cbat_1", "a-slug")).not.toBe(publishKeyFor("cbat_2", "a-slug"));
  });
});

describe("readiness", () => {
  it("passes a complete post", () => {
    expect(assessItem(item()).state).toBe("ready");
  });

  it("holds a thin post back as an exception rather than failing it", () => {
    const thin = assessItem(item({ draftMarkdown: "Too short." }));
    expect(thin.state).toBe("exception");
    expect(thin.reasons.length).toBeGreaterThan(0);
  });

  it("counts a missing image as an exception only when the batch requires one", () => {
    const noImage = item({
      image: { state: "unavailable", brief: "", altText: "", assetUrl: null, provider: null },
    });
    expect(assessItem(noImage, { requireImage: true }).state).toBe("exception");
    expect(assessItem(noImage, { requireImage: false }).state).toBe("ready");
  });

  it("counts words without counting markdown", () => {
    expect(wordCount("# Title\n\nTwo words")).toBeLessThan(5);
  });
});

describe("verification is evidence, not optimism", () => {
  const html = `<html><head><title>An operating system for founders</title>
    <link rel="canonical" href="https://trusttai.com/blog/operating-system-for-founders" /></head>
    <body>copy</body></html>`;

  it("verifies only when the live page carries the article", () => {
    const verified = verifyPublished({
      httpStatus: 200,
      html,
      requestedUrl: "https://trusttai.com/blog/operating-system-for-founders",
      expectedTitle: "An operating system for founders",
      expectedSlug: "operating-system-for-founders",
    });
    expect(verified.state).toBe("verified");
  });

  it("fails when the page answers but is the wrong article", () => {
    const wrong = verifyPublished({
      httpStatus: 200,
      html,
      requestedUrl: "https://trusttai.com/blog/something-else",
      expectedTitle: "A different article",
      expectedSlug: "something-else",
    });
    expect(wrong.state).toBe("failed");
  });

  it("fails when the URL does not answer", () => {
    const missing = verifyPublished({
      httpStatus: 404,
      html: "",
      requestedUrl: "https://trusttai.com/blog/missing",
      expectedTitle: "Missing",
      expectedSlug: "missing",
    });
    expect(missing.state).toBe("failed");
  });
});

describe("batch readout", () => {
  it("reports what is really in the batch", () => {
    const readout = readBatch([
      item(),
      item({ id: "citm_2", state: "exception" }),
      item({ id: "citm_3", state: "published" }),
      item({ id: "citm_4", state: "verified" }),
    ]);
    expect(readout).toMatchObject({ total: 4, ready: 1, exceptions: 1, published: 1, verified: 1 });
  });
});
