import { useMemo } from "react";
import { z } from "zod";
import { createFileRoute } from "@tanstack/react-router";
import { WorkspaceGate } from "@/components/tt/workspace-gate";
import { AppShell } from "@/components/tt/app-shell";
import { CorrespondenceReview } from "@/components/tt/roadmap/evidence/correspondence-review";
import { correspondenceReviewAction } from "@/data/supabase/roadmap-correspondence-review";
import type { WorkspaceIdentity } from "@/lib/workspace";
const search = z.object({
  reviewId: z.string().uuid().optional(),
  expectedDigest: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
});
export const Route = createFileRoute("/modules/roadmap/review")({
  validateSearch: search,
  head: () => ({
    meta: [
      { title: "Review correspondence · Trust Tai" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: () => (
    <WorkspaceGate appId="roadmap">
      {(identity) => (
        <ReviewRoom key={`${identity.organizationId}:${identity.userId}`} identity={identity} />
      )}
    </WorkspaceGate>
  ),
});
function ReviewRoom({ identity }: { identity: WorkspaceIdentity }) {
  const { reviewId, expectedDigest } = Route.useSearch();
  const action = useMemo(() => correspondenceReviewAction(identity.userId), [identity.userId]);
  return (
    <AppShell identity={identity}>
      <main className="mx-auto max-w-4xl space-y-6 p-6">
        {reviewId && expectedDigest ? (
          <CorrespondenceReview
            scope={{ reviewId, expectedDigest, organizationId: identity.organizationId }}
            action={action}
          />
        ) : (
          <p>
            A specific review ID and approval fingerprint are required. Ask the operator for the
            prepared review link.
          </p>
        )}
      </main>
    </AppShell>
  );
}
