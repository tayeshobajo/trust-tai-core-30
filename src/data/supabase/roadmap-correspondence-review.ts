import { supabase } from "@/integrations/trust-tai/supabase";
import {
  reviewReceiptSchema,
  reviewScopeSchema,
  correspondenceImportReceiptSchema,
  type CorrespondenceImportAction,
  type ReviewAction,
} from "@/domain/roadmap-correspondence-review";
/** Review confirmation uses the approver's current CMD session, never an operator credential. */
export function correspondenceReviewAction(userId: string): ReviewAction {
  return async (input, confirm = false) => {
    const scope = reviewScopeSchema.parse(input);
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== userId)
      throw new Error("Sign in again to review.");
    const headers = {
      Authorization: `Bearer ${before.data.session.access_token}`,
      ...(confirm ? { "Content-Type": "application/json" } : {}),
    };
    const response = await fetch(
      `/api/public/roadmap/correspondence-review${confirm ? "" : `?${new URLSearchParams(scope)}`}`,
      {
        method: confirm ? "POST" : "GET",
        headers,
        cache: "no-store",
        ...(confirm ? { body: JSON.stringify(scope) } : {}),
      },
    );
    if (!response.ok)
      throw new Error("Review unavailable. Check the current approval before retrying.");
    const receipt = reviewReceiptSchema.parse(await response.json());
    const after = await supabase.auth.getSession();
    if (
      after.error ||
      after.data.session?.user.id !== userId ||
      after.data.session.access_token !== before.data.session.access_token ||
      receipt.reviewId !== scope.reviewId ||
      receipt.digest !== scope.expectedDigest ||
      receipt.envelope.organizationId !== scope.organizationId ||
      receipt.envelope.approverId !== userId
    )
      throw new Error("Review scope or session changed.");
    return receipt;
  };
}
/** Calls the existing guarded RPC using only the current designated importer's session. */
export function correspondenceImportAction(userId: string): CorrespondenceImportAction {
  return async (input) => {
    const scope = reviewScopeSchema.parse(input);
    const before = await supabase.auth.getSession();
    if (before.error || before.data.session?.user.id !== userId)
      throw new Error("Sign in again before importing.");
    const result = await supabase.rpc("apply_roadmap_correspondence_batch", {
      batch: scope.reviewId,
      expected_digest: scope.expectedDigest,
    });
    if (result.error)
      throw new Error("Import was not confirmed. Check the saved receipt before retrying.");
    const receipt = correspondenceImportReceiptSchema.safeParse(result.data);
    const after = await supabase.auth.getSession();
    if (
      !receipt.success ||
      receipt.data.batchId !== scope.reviewId ||
      after.error ||
      after.data.session?.user.id !== userId ||
      after.data.session.access_token !== before.data.session.access_token
    )
      throw new Error(
        "Import outcome needs verification. Check the saved receipt before retrying.",
      );
    return receipt.data;
  };
}
