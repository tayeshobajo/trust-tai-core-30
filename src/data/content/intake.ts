/**
 * The Marketing source adapter.
 *
 * Studio owns the batch and the ten articles. When that package reaches a
 * human judgment boundary, Studio submits it here, once, on a stable source
 * key, and Approvals holds the decision and a pointer back. Approvals never
 * becomes a second CMS: what travels is the canonical batch id, the canonical
 * item ids, small honest facts and the exceptions.
 *
 * Nothing in this module writes an article, and nothing here publishes.
 */

import { approvalsService, type ApprovalsContext } from "@/data/supabase/approvals-service";
import { contentService } from "@/data/supabase/content-service";
import { blogBatchSubmission } from "@/data/approvals/submissions";
import type { ApprovalItemState, ApprovalRequest } from "@/domain/approvals";
import { itemFacts, readBatch, type ContentBatch, type ContentItem } from "@/domain/content";
import type { ID } from "@/domain/entities";

/** How a canonical post state reads to Approvals. */
function approvalItemState(item: ContentItem): ApprovalItemState {
  switch (item.state) {
    case "ready":
      return "ready";
    case "failed":
      return "failed";
    case "approved":
    case "queued":
    case "publishing":
      return "approved";
    case "published":
    case "verified":
      return "executed";
    case "rejected":
      return "rejected";
    default:
      return "exception";
  }
}

/**
 * The governed submission for a batch Studio already has in hand.
 *
 * Pure translation: no reads, no writes, so the room path and any backfill
 * build the same request from the same facts.
 */
export function batchSubmissionFor(batch: ContentBatch, items: ContentItem[]) {
  const readout = readBatch(items);
  const submission = blogBatchSubmission({
    batchId: batch.id,
    campaignName: batch.keyword,
    items: items.map((item) => ({
      slug: item.slug,
      title: item.title,
      state: approvalItemState(item),
      ...(item.exceptionReasons.length > 0 ? { exceptionReasons: item.exceptionReasons } : {}),
      itemId: item.id,
      wordCount: Number(itemFacts(item)["wordCount"] ?? 0),
      imageState: item.image.state === "ready" ? ("ready" as const) : ("missing" as const),
      seoState:
        item.seo.title && item.seo.metaDescription ? ("ready" as const) : ("thin" as const),
      excerpt: item.hitRationale,
      unresolvedLinks: item.internalLinks.filter((link) => !link.resolved).length,
    })),
  });

  return {
    ...submission,
    payload: {
      ...submission.payload,
      keyword: batch.keyword,
      searchIntent: batch.searchIntent,
      audienceProblem: batch.audienceProblem,
      whyTogether: batch.whyTogether,
      topicCluster: batch.topicCluster,
      readout,
    },
  };
}

/**
 * Submit a prepared batch for judgment, idempotently.
 *
 * The batch id is the source entity, so submitting the same batch twice is
 * one card. A batch with nothing left to decide is not submitted at all.
 */
export async function submitContentBatchForApproval(
  batchId: ID,
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  const loaded = await contentService.getBatch(context, batchId);
  if (!loaded) throw new Error("That content batch is not in this workspace.");
  const { batch, items } = loaded;

  const undecided = items.filter((item) =>
    ["ready", "exception", "failed"].includes(item.state),
  );
  if (undecided.length === 0) return null;

  const request = await approvalsService.submit(context, batchSubmissionFor(batch, items));
  if (batch.state !== "submitted") {
    await contentService.setBatchState(context, batch.id, "submitted");
  }
  return request;
}

/** The same hook where a failure must not lose the batch Studio just wrote. */
export async function submitContentBatchQuietly(
  batchId: ID,
  context: ApprovalsContext,
): Promise<ApprovalRequest | null> {
  try {
    return await submitContentBatchForApproval(batchId, context);
  } catch (error) {
    console.warn("[approvals] content batch intake deferred:", (error as Error).message);
    return null;
  }
}

export interface ContentIntakeReport {
  scanned: number;
  submitted: number;
  skipped: number;
  failed: number;
  errors: string[];
}

/**
 * Catch-up for real batches prepared before the seam existed.
 *
 * Reads only real rows and submits each through the same adapter, so a second
 * run changes nothing.
 */
export async function backfillContentApprovals(
  context: ApprovalsContext,
): Promise<ContentIntakeReport> {
  const report: ContentIntakeReport = {
    scanned: 0,
    submitted: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };
  const batches = await contentService.listBatches(context, 50);
  report.scanned = batches.length;

  for (const batch of batches) {
    if (batch.state === "preparing" || batch.state === "failed" || batch.state === "closed") {
      report.skipped += 1;
      continue;
    }
    try {
      const request = await submitContentBatchForApproval(batch.id, context);
      if (request) report.submitted += 1;
      else report.skipped += 1;
    } catch (error) {
      report.failed += 1;
      report.errors.push((error as Error).message);
    }
  }

  return report;
}
