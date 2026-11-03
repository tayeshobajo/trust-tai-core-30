import { supabase } from "@/integrations/trust-tai/supabase";
import {
  reviewReceiptSchema,
  reviewScopeSchema,
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
