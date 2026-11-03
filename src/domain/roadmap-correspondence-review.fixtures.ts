import { event, org, user } from "./roadmap-correspondence.fixtures";
import type { ReviewReceipt } from "./roadmap-correspondence-review";
export const reviewFixture: ReviewReceipt = {
  reviewId: "00000000-0000-4000-8000-000000000090",
  digest: "b".repeat(64),
  approvedAt: null,
  approvedBy: null,
  envelope: {
    version: 1,
    organizationId: org,
    importerId: user,
    approverId: user,
    expiresAt: "2099-01-01T00:00:00Z",
    audiencePolicy: "authorized_roadmap_team_with_future_members",
    audience: [
      user,
      ...Array.from(
        { length: 8 },
        (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ),
    ],
    selections: [{ event, mappingDigest: "c".repeat(64) }],
  },
};
export const reviewScope = {
  reviewId: reviewFixture.reviewId,
  organizationId: org,
  expectedDigest: reviewFixture.digest,
};
