/**
 * Trust Tai OS, the Content contract.
 *
 * Studio owns the article. Approvals owns the decision about it. The publish
 * adapter owns the transport and its receipt. This module is the pure part:
 * the shapes, the state machine and the rules that decide when a post is
 * genuinely ready for a person to look at, and when it is an exception.
 *
 * The laws it encodes:
 *
 *   - Nothing reaches the publish queue without a recorded human approval of
 *     that specific post.
 *   - Attempted, Executed and Verified are three distinct states. A publish
 *     without an independent read of the live URL stays unverified.
 *   - No invented precision. There is no numeric HIT score here, because
 *     nothing measures one. There is a written rationale instead.
 *   - Unknown is said, not filled in: an internal link Studio could not
 *     resolve stays unresolved rather than becoming a plausible URL.
 */

import type { ExceptionReason } from "./approvals";
import type { ID, ISODateTime } from "./entities";

/** The room that owns content. Registered as Studio in the app registry. */
export const CONTENT_APP_ID = "studio";

/** The shortest post Studio will offer for judgment without flagging it. */
export const MIN_PUBLISHABLE_WORDS = 600;

/* ------------------------------------------------------------ the batch */

export type ContentBatchState =
  /** The command is running. */
  | "preparing"
  /** Every post has been attempted; the batch can be reviewed. */
  | "prepared"
  /** A blog_batch approval exists for it. */
  | "submitted"
  /** Some children were approved; others were not. */
  | "partially_approved"
  /** Nothing is left to decide. */
  | "closed"
  /** The command itself failed before producing a package. */
  | "failed";

export interface EditorialStep {
  position: number;
  slug: string;
  role: string;
}

export interface ContentBatch {
  id: ID;
  organizationId: ID;
  keyword: string;
  state: ContentBatchState;
  topicCluster: string[];
  searchIntent: string;
  audienceProblem: string;
  editorialPlan: EditorialStep[];
  whyTogether: string;
  provenance: Record<string, unknown>;
  createdBy?: ID | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/* ------------------------------------------------------------- the post */

export type ContentItemState =
  | "preparing"
  | "ready"
  | "exception"
  | "failed"
  | "approved"
  | "queued"
  | "publishing"
  | "published"
  | "verified"
  | "rejected"
  | "revision_requested";

export const CONTENT_ITEM_STATE_LABEL: Record<ContentItemState, string> = {
  preparing: "Preparing",
  ready: "Ready for review",
  exception: "Needs you",
  failed: "Failed to prepare",
  approved: "Approved",
  queued: "Queued to publish",
  publishing: "Publishing",
  published: "Published, unverified",
  verified: "Verified live",
  rejected: "Not now",
  revision_requested: "Revision requested",
};

/**
 * Every legal move. Absent means refused, so no retry, no adapter and no UI
 * path can promote a post to `queued` without an approval first.
 */
export const ALLOWED_ITEM_TRANSITIONS: Record<ContentItemState, ContentItemState[]> = {
  preparing: ["ready", "exception", "failed"],
  ready: ["exception", "approved", "rejected", "revision_requested"],
  exception: ["ready", "approved", "rejected", "revision_requested"],
  failed: ["revision_requested", "rejected", "ready", "exception"],
  approved: ["queued", "rejected"],
  queued: ["publishing", "rejected"],
  publishing: ["published", "queued", "failed"],
  published: ["verified", "publishing"],
  verified: [],
  rejected: [],
  revision_requested: ["ready", "exception", "failed", "rejected"],
};

export function canItemTransition(from: ContentItemState, to: ContentItemState): boolean {
  return ALLOWED_ITEM_TRANSITIONS[from].includes(to);
}

export function assertItemTransition(from: ContentItemState, to: ContentItemState): void {
  if (from === to) return;
  if (!canItemTransition(from, to)) {
    throw new Error(
      `A post cannot move from "${CONTENT_ITEM_STATE_LABEL[from]}" to "${CONTENT_ITEM_STATE_LABEL[to]}".`,
    );
  }
}

/** True once a person authorised this specific post. */
export function isItemAuthorised(state: ContentItemState): boolean {
  return ["approved", "queued", "publishing", "published", "verified"].includes(state);
}

export interface ContentSeo {
  title: string;
  metaDescription: string;
  slug: string;
}

/** A link Studio proposes. An unresolved link is never given a URL. */
export interface InternalLink {
  anchor: string;
  /** The real known path on trusttai.com, or null when nothing matched. */
  path: string | null;
  resolved: boolean;
  because: string;
}

export interface EarnedCta {
  readerNeed: string;
  offer: string;
  line: string;
}

export type ImageState = "ready" | "pending" | "unavailable";

export interface ContentImage {
  state: ImageState;
  brief: string;
  altText: string;
  assetUrl: string | null;
  provider: string | null;
}

export interface ContentGeneration {
  provider: string;
  model: string;
  at: ISODateTime;
  runId?: string | null;
}

export type PublishState = "none" | "attempted" | "executed" | "failed";

export interface ContentPublish {
  state: PublishState;
  attemptedAt?: ISODateTime | null;
  executedAt?: ISODateTime | null;
  provider?: string | null;
  because?: string;
  receipt?: Record<string, unknown>;
}

export type VerificationState = "unverified" | "verified" | "failed";

export interface ContentVerification {
  state: VerificationState;
  checkedAt?: ISODateTime | null;
  httpStatus?: number | null;
  canonicalUrl?: string | null;
  titleMatched?: boolean | null;
  publishedAtSeen?: string | null;
  because: string;
}

export interface ContentItem {
  id: ID;
  organizationId: ID;
  batchId: ID;
  position: number;
  slug: string;
  title: string;
  angle: string;
  readerJob: string;
  brief: { outline: string[]; mustCover: string[]; sources: string[] };
  draftMarkdown: string;
  hitRationale: string;
  seo: ContentSeo;
  internalLinks: InternalLink[];
  cta: EarnedCta;
  taxonomy: { category: string; tags: string[] };
  image: ContentImage;
  generation?: ContentGeneration | null;
  state: ContentItemState;
  exceptionReasons: ExceptionReason[];
  failureReason?: string | null;
  /** Stable transport identity. A retry reuses it and cannot double-post. */
  publishKey: string;
  publish: ContentPublish;
  verification: ContentVerification;
  externalPostId?: string | null;
  canonicalUrl?: string | null;
  publishedAt?: ISODateTime | null;
  createdAt: ISODateTime;
  updatedAt: ISODateTime;
}

/** The transport identity of one post. Deterministic, never regenerated. */
export function publishKeyFor(batchId: ID, slug: string): string {
  return `content:${batchId}:${slug}`;
}

/* -------------------------------------------------------- readiness rules */

export interface ItemReadiness {
  state: Extract<ContentItemState, "ready" | "exception" | "failed">;
  reasons: ExceptionReason[];
  /** Plain language, shown to the person deciding. */
  notes: string[];
}

export function wordCount(markdown: string): number {
  return markdown.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Whether a post can honestly be offered as ready.
 *
 * A post with no draft is a failure, not an exception: there is nothing to
 * judge. Everything else that falls short is an exception with a named reason,
 * so the person sees why it rose rather than a score.
 */
export function assessItem(
  item: Pick<
    ContentItem,
    "draftMarkdown" | "hitRationale" | "seo" | "internalLinks" | "image" | "cta"
  >,
  policy: { requireImage: boolean } = { requireImage: true },
): ItemReadiness {
  const reasons: ExceptionReason[] = [];
  const notes: string[] = [];

  const words = wordCount(item.draftMarkdown);
  if (words === 0) {
    return {
      state: "failed",
      reasons: [],
      notes: ["No draft was produced for this post."],
    };
  }

  if (words < MIN_PUBLISHABLE_WORDS) {
    reasons.push("weak_hit");
    notes.push(`The draft is ${words} words, under the ${MIN_PUBLISHABLE_WORDS} word bar.`);
  }
  if (!item.hitRationale.trim()) {
    reasons.push("low_confidence");
    notes.push("Studio could not say why this one deserves a reader's time.");
  }
  if (!item.seo.title.trim() || !item.seo.metaDescription.trim() || !item.seo.slug.trim()) {
    reasons.push("low_confidence");
    notes.push("The SEO title, description or slug is missing.");
  }
  if (!item.cta.line.trim()) {
    reasons.push("low_confidence");
    notes.push("No earned call to action was written for this piece.");
  }
  if (item.internalLinks.some((link) => !link.resolved)) {
    const count = item.internalLinks.filter((link) => !link.resolved).length;
    notes.push(`${count} suggested internal link${count === 1 ? "" : "s"} could not be resolved to a real page.`);
  }
  if (policy.requireImage && item.image.state !== "ready") {
    reasons.push("low_confidence");
    notes.push(
      item.image.state === "unavailable"
        ? "No image provider is connected, so this post has a brief but no asset."
        : "The featured image is still pending.",
    );
  }

  const unique = [...new Set(reasons)];
  return { state: unique.length > 0 ? "exception" : "ready", reasons: unique, notes };
}

/** The small, honest facts a batch approval shows per child. */
export function itemFacts(item: ContentItem): Record<string, unknown> {
  return {
    wordCount: wordCount(item.draftMarkdown),
    imageState: item.image.state === "ready" ? "ready" : "missing",
    seoState: item.seo.title && item.seo.metaDescription ? "ready" : "thin",
    slug: item.seo.slug || item.slug,
    excerpt: item.hitRationale.slice(0, 220),
    unresolvedLinks: item.internalLinks.filter((link) => !link.resolved).length,
  };
}

/* --------------------------------------------------------- publish rules */

export interface PublishRefusal {
  because: string;
}

/**
 * May this post be handed to the transport right now?
 *
 * Fails closed on everything: an unapproved post, a rejected post, a post
 * already live, an image the source policy requires, or a post the queue has
 * not accepted yet.
 */
export function publishRefusal(
  item: Pick<ContentItem, "state" | "image" | "externalPostId">,
  policy: { requireImage: boolean } = { requireImage: true },
): PublishRefusal | null {
  if (!isItemAuthorised(item.state)) {
    return { because: "No one has approved this post, so it cannot be published." };
  }
  if (item.state === "approved") {
    return { because: "The post is approved but not queued yet." };
  }
  if (item.state === "published" || item.state === "verified") {
    return { because: "This post is already live. Publishing again would duplicate it." };
  }
  if (policy.requireImage && item.image.state !== "ready") {
    return { because: "The featured image is missing and this batch requires one." };
  }
  return null;
}

/** What an independent read of the live URL has to agree on. */
export interface VerificationInput {
  httpStatus: number;
  html: string;
  requestedUrl: string;
  expectedTitle: string;
  expectedSlug: string;
}

export function verifyPublished(input: VerificationInput): ContentVerification {
  const at = new Date().toISOString();
  if (input.httpStatus < 200 || input.httpStatus >= 300) {
    return {
      state: "failed",
      checkedAt: at,
      httpStatus: input.httpStatus,
      canonicalUrl: null,
      titleMatched: false,
      because: `The live URL answered ${input.httpStatus}.`,
    };
  }

  const canonical = /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i.exec(input.html);
  const canonicalUrl = canonical?.[1] ?? null;
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(input.html)?.[1]?.trim() ?? "";
  const published =
    /<meta[^>]+property=["']article:published_time["'][^>]*content=["']([^"']+)["']/i.exec(
      input.html,
    )?.[1] ?? null;

  const titleMatched =
    title.toLowerCase().includes(input.expectedTitle.trim().toLowerCase()) &&
    input.expectedTitle.trim().length > 0;
  const slugMatched =
    (canonicalUrl ?? input.requestedUrl).toLowerCase().includes(input.expectedSlug.toLowerCase());

  if (!titleMatched || !slugMatched) {
    return {
      state: "failed",
      checkedAt: at,
      httpStatus: input.httpStatus,
      canonicalUrl,
      titleMatched,
      publishedAtSeen: published,
      because: !slugMatched
        ? "The live page does not carry the expected canonical path."
        : "The live page does not carry the expected article title.",
    };
  }

  return {
    state: "verified",
    checkedAt: at,
    httpStatus: input.httpStatus,
    canonicalUrl,
    titleMatched: true,
    publishedAtSeen: published,
    because: "The live URL answered, matched the canonical path and carried the article title.",
  };
}

/* --------------------------------------------------------------- summary */

export interface BatchReadout {
  total: number;
  ready: number;
  exceptions: number;
  failed: number;
  approved: number;
  published: number;
  verified: number;
}

export function readBatch(items: ContentItem[]): BatchReadout {
  const count = (predicate: (item: ContentItem) => boolean) => items.filter(predicate).length;
  return {
    total: items.length,
    ready: count((item) => item.state === "ready"),
    exceptions: count((item) => item.state === "exception"),
    failed: count((item) => item.state === "failed"),
    approved: count((item) => ["approved", "queued", "publishing"].includes(item.state)),
    published: count((item) => item.state === "published"),
    verified: count((item) => item.state === "verified"),
  };
}
