import { describe, expect, it } from "vitest";
import { reviewOutcome, type MeasurePoint } from "./client-care";
import {
  attributeEnquiry,
  openNextRoadmap,
  prepareContentBrief,
  type ApprovedLesson,
} from "./demand-attribution";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const CLIENT = "fixture-client-northwind";
const AT = "2026-04-01T09:00:00.000Z";

const point = (over: Partial<MeasurePoint>): MeasurePoint => ({
  key: "qualified_meetings",
  label: "Qualified meetings",
  value: 12,
  unit: "count",
  tier: "observed",
  ...over,
});

const review = reviewOutcome({
  clientRef: CLIENT,
  baseline: point({ value: 4, evidenceRef: "fixture:baseline/1" }),
  target: point({ value: 10, tier: "decided" }),
  observed: point({ value: 12, evidenceRef: "fixture:report/1" }),
});

const lesson = (over: Partial<ApprovedLesson> = {}): ApprovedLesson => ({
  id: "lesson-1",
  clientRef: CLIENT,
  text: "Shorter discovery calls produced clearer briefs.",
  approvedBy: "person-1",
  approvedAt: AT,
  contentUseApproved: true,
  clientNamingApproved: false,
  evidenceRef: "fixture:review/1",
  ...over,
});

describe("content brief", () => {
  it("refuses a lesson that was never approved for content", () => {
    const result = prepareContentBrief({
      organizationId: ORG,
      clientRef: CLIENT,
      audience: "Founders of small agencies",
      goal: "Explain how we shorten discovery",
      lessons: [lesson({ contentUseApproved: false })],
      requestedBy: "person-1",
      requestedAt: AT,
    });
    expect(result.prepared).toBe(false);
    if (!result.prepared) expect(result.excluded.join(" ")).toContain("not been approved");
  });

  it("leaves another client's lesson out", () => {
    const result = prepareContentBrief({
      organizationId: ORG,
      clientRef: CLIENT,
      audience: "Founders",
      goal: "Explain discovery",
      lessons: [lesson(), lesson({ id: "lesson-2", clientRef: "other-client" })],
      requestedBy: "person-1",
      requestedAt: AT,
    });
    expect(result.prepared).toBe(true);
    if (result.prepared) {
      expect(result.brief.points).toHaveLength(1);
      expect(result.brief.excluded.join(" ")).toContain("another client");
    }
  });

  it("needs an audience and a goal", () => {
    const result = prepareContentBrief({
      organizationId: ORG,
      clientRef: CLIENT,
      audience: "",
      goal: "Explain discovery",
      lessons: [lesson()],
      requestedBy: "person-1",
      requestedAt: AT,
    });
    expect(result.prepared).toBe(false);
  });

  it("never assumes naming or publication permission", () => {
    const result = prepareContentBrief({
      organizationId: ORG,
      clientRef: CLIENT,
      audience: "Founders",
      goal: "Explain discovery",
      lessons: [lesson()],
      review,
      requestedBy: "person-1",
      requestedAt: AT,
    });
    expect(result.prepared).toBe(true);
    if (result.prepared) {
      expect(result.brief.clientMayBeNamed).toBe(false);
      expect(result.brief.publicationApproved).toBe(false);
      expect(result.brief.sourceRefs).toContain("fixture:report/1");
    }
  });
});

describe("attribution", () => {
  it("links only when the enquiry carried evidence", () => {
    const linked = attributeEnquiry({
      contentRef: "content-1",
      enquiryEvidence: [
        { kind: "campaign_parameter", value: "utm_content=discovery-note", observedAt: AT },
      ],
      knownMarkers: ["discovery-note"],
    });
    expect(linked.linked).toBe(true);
    if (linked.linked) expect(linked.claim).toContain("does not say the content caused any revenue");
  });

  it("claims nothing from timing alone", () => {
    const linked = attributeEnquiry({
      contentRef: "content-1",
      enquiryEvidence: [{ kind: "referrer", value: "https://example.test/", observedAt: AT }],
      knownMarkers: ["discovery-note"],
    });
    expect(linked.linked).toBe(false);
  });
});

describe("next roadmap", () => {
  it("opens once with an owner and returns the first on retry", () => {
    const first = openNextRoadmap({ review, ownerId: "person-1", at: AT });
    expect(first.opened).toBe(true);
    if (!first.opened) return;
    const again = openNextRoadmap({
      review,
      ownerId: "person-2",
      at: "2026-04-05T09:00:00.000Z",
      existing: [first.handoff],
    });
    expect(again).toMatchObject({ opened: true, alreadyExisted: true });
    if (again.opened) expect(again.handoff.ownerId).toBe("person-1");
  });

  it("refuses without a named owner", () => {
    expect(openNextRoadmap({ review, ownerId: " ", at: AT }).opened).toBe(false);
  });

  it("refuses when the result cannot be told", () => {
    const unclear = reviewOutcome({
      clientRef: CLIENT,
      baseline: point({ value: 4 }),
      target: point({ value: null }),
      observed: point({ value: 12 }),
    });
    expect(openNextRoadmap({ review: unclear, ownerId: "person-1", at: AT }).opened).toBe(false);
  });
});

describe("synthetic care to review to next roadmap loop", () => {
  it("runs end to end without claiming anything unearned", () => {
    expect(review.targetReached).toBe(true);
    const opened = openNextRoadmap({ review, ownerId: "person-1", at: AT });
    expect(opened.opened).toBe(true);
    const brief = prepareContentBrief({
      organizationId: ORG,
      clientRef: CLIENT,
      audience: "Founders",
      goal: "Explain discovery",
      lessons: [lesson()],
      review,
      requestedBy: "person-1",
      requestedAt: AT,
    });
    expect(brief.prepared).toBe(true);
    if (brief.prepared) expect(brief.brief.publicationApproved).toBe(false);
  });
});
