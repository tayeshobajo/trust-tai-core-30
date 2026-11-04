import type { Roadmap } from "../../src/domain/roadmap";
import type { Correspondence, CorrespondencePage } from "../../src/domain/roadmap-correspondence";
import type {
  PublicationObservation,
  ReviewedBinding,
  PartialInteractionHistory,
} from "../../src/domain/roadmap-evidence";
import type { ConversationSummary } from "../../src/domain/roadmap-correspondence-summary";
import type { StandingReview } from "../../src/domain/roadmap-followup";
export const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const org = id(900),
  user = id(901),
  now = new Date("2026-11-04T12:00:00Z");
const companies = [
  "Cedar Tax Studio",
  "Beacon Building Inspection",
  "Aspen Creek Farm",
  "Cambrian Landscape Studio",
  "Evergreen Wellness",
  "Harbor Leadership",
  "Northstar Systems",
  "Riverstone Labs",
];
export const fixtureRoadmaps: Roadmap[] = companies.map((name, i) => ({
  id: id(100 + i),
  organizationId: org,
  prospectId: id(200 + i),
  relationshipId: id(300 + i),
  title: name,
  subjectLabel: name,
  objective: `Fictional preview roadmap for ${name}.`,
  status: "draft",
  ...(i === 0 || i === 3 || i === 5 ? { ownerUserId: user } : {}),
  pointA: [],
  pointB: null,
  nextMove: {
    action:
      i === 0
        ? "Schedule a conversation about next steps"
        : i === 3
          ? "Confirm the agreed scope"
          : i === 5
            ? "Review the next milestone"
            : "Agree on the next step",
    because: "Fictional local preview",
    tier: "decided",
    ...(i === 0 || i === 3 || i === 5 ? { ownerUserId: user, ownerLabel: "Morgan · preview" } : {}),
  },
  metadata: {
    synthetic_fixture: true,
    outreach_tracker: {
      fields: {
        followUpDate: [
          "2026-10-26",
          "2026-11-05",
          "2026-11-06",
          "2026-11-09",
          "2026-10-29",
          "2026-11-10",
          null,
          "2026-11-04",
        ][i],
      },
    },
    ...(i === 4
      ? {
          outreach_holds: [
            {
              kind: "permanent_email_bounce",
              source: "Fictional fixture only",
              outreach_suppressed: true,
            },
          ],
        }
      : {}),
  },
  createdAt: "2026-10-20T12:00:00Z",
  updatedAt: "2026-11-03T10:00:00Z",
}));
export const slug = (i: number) => `fictional-${i}`;
export const publication: PublicationObservation = {
  sourceUrl: "https://example.test/fictional-directory",
  checkedAt: "2026-11-04T09:00:00Z",
  entries: companies.map((name, i) => ({
    slug: slug(i),
    name,
    url: `https://example.test/roadmaps/${slug(i)}`,
  })),
};
export const bindings: ReviewedBinding[] = fixtureRoadmaps.map((r, i) => ({
  organizationId: org,
  roadmapId: r.id,
  slug: slug(i),
  reviewedAt: "2026-11-04T09:00:00Z",
  reviewedBy: "Fictional preview reviewer",
}));
const base = (
  i: number,
  n: number,
  body: string,
  at: string,
  kind: Correspondence["kind"] = "sent",
): Correspondence => ({
  organizationId: org,
  roadmapId: id(100 + i),
  relationshipId: id(300 + i),
  roadmapRevision: "2026-11-03T10:00:00Z",
  relationshipRevision: "2026-11-03T10:00:00Z",
  channel: i === 7 ? "linkedin_sales_navigator" : "email",
  kind,
  sourceAccountRef: "synthetic-preview-account",
  sourceEventId: `synthetic-${i}-${n}`,
  identityKind: i === 7 ? "reviewed_receipt" : "provider_id",
  sourceUrl:
    i === 7
      ? `https://www.linkedin.com/sales/inbox/fictional-${i}`
      : `https://mail.google.com/mail/u/0/#all/fictional-${i}-${n}`,
  occurredAt: at,
  timestampPrecision: "exact",
  verifiedAt: "2026-11-04T08:00:00Z",
  subject:
    n === 0
      ? `A roadmap for the next chapter of ${companies[i]}`
      : `Re: A roadmap for ${companies[i]}`,
  bodyText: body,
  bodyRepresentation: "reviewed_full_text",
  review: {
    reviewerId: user,
    reviewedAt: "2026-11-04T09:00:00Z",
    relevance: "roadmap_correspondence",
    identity: "verified",
    audience: "authorized_roadmap_team",
    unrelatedContentExcluded: true,
    quotedHistoryExcluded: true,
    secretsExcluded: true,
    attachmentsExcluded: true,
    sourceRef: "synthetic-fixture-not-real-correspondence",
  },
});
export const fixtureEvents: Correspondence[] = [
  base(
    0,
    0,
    "Hi there, I’ve prepared a proposed roadmap for Cedar Tax Studio. It brings the next few decisions together so your team can review the sequence and choose where to begin.",
    "2026-10-22T21:50:00Z",
  ),
  base(
    0,
    1,
    "Thanks, Morgan. We’ve reviewed the proposal and have a few questions before deciding what comes next. Could we find a time to talk through the options?",
    "2026-10-22T21:51:00Z",
    "received",
  ),
  base(
    0,
    2,
    "Absolutely. Here are a few options for a conversation:\n• Thursday morning\n• Friday afternoon\n\nLet me know what works best for your team.",
    "2026-10-26T09:58:00Z",
  ),
  ...companies
    .slice(1)
    .map((_, k) =>
      base(
        k + 1,
        0,
        [
          "Thanks for the roadmap. Can we review it together?",
          "The roadmap looks useful. We have one question.",
          "Confirmed for next week. Looking forward to it.",
          "Following up on the proposal. Please review the saved contact hold.",
          "The next milestone is ready for our review.",
          "We need to agree on a follow-up date.",
          "A proposed roadmap is ready for you to review.",
        ][k]!,
        "2026-11-03T10:00:00Z",
        k === 2 || k === 4 ? "received" : "sent",
      ),
    ),
];
export const history: PartialInteractionHistory = {
  status: "partial_known_client_interactions",
  coverage: "FICTIONAL preview only, not real correspondence",
  interactions: fixtureEvents
    .filter((e) => e.channel === "email")
    .map((e) => ({
      client_slug: slug(Number(e.roadmapId.slice(-12)) - 100),
      account: "preview@example.test",
      message_id: e.sourceEventId,
      thread_id: `fictional-thread-${e.roadmapId}`,
      direction: e.kind === "received" ? "received" : "sent",
      date_utc: e.occurredAt,
      from: e.kind === "received" ? "fictional-person@example.test" : "preview@example.test",
      to: e.kind === "received" ? "preview@example.test" : "fictional-person@example.test",
      cc: "",
      subject: e.subject,
      body_text: e.bodyText,
      source_url: e.sourceUrl,
      content_safety: "Fictional plain text, not a real source",
    })),
};
export const summary: ConversationSummary = {
  organizationId: org,
  readAt: "2026-11-04T09:00:00Z",
  records: fixtureRoadmaps.map((r) => {
    const e = fixtureEvents
      .filter((e) => e.roadmapId === r.id)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt))[0]!;
    return {
      roadmapId: r.id,
      latest: { channel: e.channel, kind: e.kind, at: e.occurredAt },
      hasSent: true,
      hasReceived: fixtureEvents.some((e) => e.roadmapId === r.id && e.kind === "received"),
      coverage: "partial",
    };
  }),
};
export const reviews: Record<string, StandingReview> = {};
for (const i of [3, 5])
  reviews[slug(i)] = {
    reviewedAt: "2026-11-04T09:00:00Z",
    validThrough: "2026-11-12",
    reviewer: "Fictional preview reviewer",
    sourceRef: "synthetic-health-review",
    coverage: "reviewed_current",
  };
export async function readFixture(
  organizationId: string,
  roadmapId: string,
): Promise<CorrespondencePage> {
  if (organizationId !== org) throw new Error("Fictional scope only");
  const r = fixtureRoadmaps.find((r) => r.id === roadmapId);
  if (!r) throw new Error("Fictional record not found");
  return {
    organizationId: org,
    roadmapId,
    relationshipId: r.relationshipId!,
    events: fixtureEvents
      .filter((e) => e.roadmapId === roadmapId)
      .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)),
    nextCursor: null,
    coverage: "partial",
    readAt: "2026-11-04T09:00:00Z",
  };
}
