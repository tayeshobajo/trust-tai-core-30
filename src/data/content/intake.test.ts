/**
 * The Marketing source adapter must translate, not copy.
 *
 * Approvals gets one card for one batch, pointers back to the canonical posts,
 * honest per-child facts and the exceptions. It must never receive the article
 * bodies, and it must never make a batch look readier than it is.
 */

import { describe, expect, it } from "vitest";

import { batchSubmissionFor } from "./intake";
import { publishKeyFor, type ContentBatch, type ContentItem } from "@/domain/content";

const now = new Date().toISOString();

const batch: ContentBatch = {
  id: "cbat_1",
  organizationId: "org_1",
  keyword: "fractional operations",
  state: "prepared",
  topicCluster: ["fractional operations", "founder time"],
  searchIntent: "Understand whether fractional operations suits a small team.",
  audienceProblem: "The founder is the bottleneck and cannot see where.",
  whyTogether: "Each piece answers the next question the reader asks.",
  editorialPlan: [{ position: 0, slug: "a", role: "Sets the problem." }],
  provenance: { provider: "lovable" },
  createdBy: "user_1",
  createdAt: now,
  updatedAt: now,
} as ContentBatch;

function item(overrides: Partial<ContentItem> = {}): ContentItem {
  return {
    id: "citm_1",
    organizationId: "org_1",
    batchId: "cbat_1",
    position: 0,
    slug: "a",
    title: "Where the founder becomes the bottleneck",
    angle: "",
    readerJob: "",
    brief: { outline: [], mustCover: [], sources: [] },
    draftMarkdown: Array.from({ length: 700 }, (_, index) => `w${index}`).join(" "),
    hitRationale: "It names the thing the reader already suspects.",
    seo: { title: "T", metaDescription: "M", slug: "a" },
    internalLinks: [],
    cta: { readerNeed: "", offer: "", line: "" },
    taxonomy: { category: "", tags: [] },
    image: { state: "ready", brief: "", altText: "", assetUrl: "x", provider: "p" },
    generation: null,
    state: "ready",
    exceptionReasons: [],
    failureReason: null,
    publishKey: publishKeyFor("cbat_1", "a"),
    publish: { state: "none" },
    verification: { state: "unverified", because: "Not checked yet." },
    externalPostId: null,
    canonicalUrl: null,
    publishedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  } as ContentItem;
}

describe("content batch submission", () => {
  it("submits one batch as one decision, with one child per post", () => {
    const submission = batchSubmissionFor(batch, [
      item(),
      item({ id: "citm_2", slug: "b", state: "exception", exceptionReasons: ["weak_hit"] }),
    ]);

    expect(submission.approvalType).toBe("blog_batch");
    expect(submission.sourceEntity).toMatchObject({ type: "content_batch", id: "cbat_1" });
    expect(submission.items).toHaveLength(2);
    expect(submission.status).toBe("needs_review");
  });

  it("points back at the canonical post rather than copying it", () => {
    const submission = batchSubmissionFor(batch, [item()]);
    const child = submission.items![0]!;

    expect(child.sourceEntity).toMatchObject({ type: "content_item", id: "citm_1" });
    expect(JSON.stringify(submission)).not.toContain("w699");
  });

  it("carries honest facts, including what is missing", () => {
    const submission = batchSubmissionFor(batch, [
      item({
        image: { state: "unavailable", brief: "", altText: "", assetUrl: null, provider: null },
        internalLinks: [{ anchor: "next", path: null, resolved: false, because: "no match" }],
      }),
    ]);
    const facts = submission.items![0]!.facts as Record<string, unknown>;

    expect(facts["imageState"]).toBe("missing");
    expect(facts["unresolvedLinks"]).toBe(1);
  });

  it("says plainly that publishing is not what approval does", () => {
    const submission = batchSubmissionFor(batch, [item()]);
    expect(submission.boundary.willNotDo.join(" ").toLowerCase()).toContain("publish");
  });
});
