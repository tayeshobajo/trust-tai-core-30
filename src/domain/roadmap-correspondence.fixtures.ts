import type { Correspondence } from "./roadmap-correspondence";
export const org = "00000000-0000-4000-8000-000000000001",
  roadmap = "00000000-0000-4000-8000-000000000002",
  relationship = "00000000-0000-4000-8000-000000000003",
  user = "00000000-0000-4000-8000-000000000004";
const now = new Date("2026-11-03T12:00:00Z");
export const event: Correspondence = {
  organizationId: org,
  roadmapId: roadmap,
  relationshipId: relationship,
  roadmapRevision: "2026-11-03T00:00:00Z",
  relationshipRevision: "2026-11-03T00:00:00Z",
  channel: "email",
  kind: "sent",
  sourceAccountRef: "synthetic-account",
  sourceEventId: "synthetic-message",
  identityKind: "provider_id",
  sourceUrl: "https://mail.google.com/mail/u/0/#all/synthetic-message",
  occurredAt: "2026-11-02T10:00:00Z",
  timestampPrecision: "exact",
  verifiedAt: "2026-11-03T09:00:00Z",
  subject: "Synthetic roadmap",
  bodyText: "SYNTHETIC: Please review the roadmap milestone.",
  bodyRepresentation: "reviewed_redacted_excerpt",
  review: {
    reviewerId: user,
    reviewedAt: "2026-11-03T10:00:00Z",
    relevance: "roadmap_correspondence",
    identity: "verified",
    audience: "authorized_roadmap_team",
    unrelatedContentExcluded: true,
    quotedHistoryExcluded: true,
    secretsExcluded: true,
    attachmentsExcluded: true,
    sourceRef: "synthetic-review",
  },
};

export const roadmapId = roadmap;
export const relationshipId = relationship;
export const userId = user;
