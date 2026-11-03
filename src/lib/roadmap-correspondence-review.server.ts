import { reviewScopeSchema, reviewReceiptSchema } from "@/domain/roadmap-correspondence-review";
import {
  authorizeTracker,
  TrackerRequestError,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";
/** Existing caller JWT only. No staging, operator credential, or client-supplied approver. */
export async function reviewRoadmapCorrespondence(request: Request): Promise<Response> {
  try {
    const confirm = request.method === "POST";
    if (!confirm && request.method !== "GET")
      throw new TrackerRequestError("Unsupported review method.", 405);
    let input: unknown;
    if (confirm) {
      const body = await request.text();
      if (body.length > 2048) throw new TrackerRequestError("Review request too large.", 413);
      try {
        input = JSON.parse(body);
      } catch {
        throw new TrackerRequestError("Invalid review request.", 400);
      }
    } else {
      const params = new URL(request.url).searchParams;
      if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
        throw new TrackerRequestError("Invalid review scope.", 400);
      input = Object.fromEntries(params);
    }
    const parsed = reviewScopeSchema.safeParse(input);
    if (!parsed.success) throw new TrackerRequestError("Valid review scope is required.", 400);
    const scope = parsed.data;
    const before = await authorizeTracker(request, scope.organizationId, true);
    const result = await before.client.rpc("review_roadmap_correspondence", {
      b: scope.reviewId,
      org: scope.organizationId,
      expected: scope.expectedDigest,
      confirm,
    });
    // Never return database errors or rejected payloads that may contain private text.
    if (result.error)
      throw new TrackerRequestError(
        "Review could not be verified. Reopen the approved scope.",
        409,
      );
    const receipt = reviewReceiptSchema.safeParse(result.data);
    if (
      !receipt.success ||
      receipt.data.reviewId !== scope.reviewId ||
      receipt.data.digest !== scope.expectedDigest ||
      receipt.data.envelope.organizationId !== scope.organizationId ||
      receipt.data.envelope.approverId !== before.user.id ||
      (confirm && (!receipt.data.approvedAt || receipt.data.approvedBy !== before.user.id))
    )
      throw new TrackerRequestError("Review response scope could not be verified.", 503);
    const after = await authorizeTracker(request, scope.organizationId, true);
    if (after.user.id !== before.user.id)
      throw new TrackerRequestError("Session changed. Reopen the review.", 401);
    return Response.json(receipt.data, { headers: trackerHeaders });
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
