import { describe, expect, it } from "vitest";
import {
  careGaps,
  openCarePlan,
  proposeOpportunity,
  readCareHealth,
  reviewOutcome,
  suggestionIsPermitted,
  triageFromEvents,
  type CarePlan,
  type HealthEvent,
  type MeasurePoint,
} from "./client-care";

const ORG = "org-fixture-0000-0000-0000-000000000001";
const CLIENT = "fixture-client-northwind";
const AT = "2026-04-01T09:00:00.000Z";

function plan(recorded?: Record<string, string>): CarePlan {
  const result = openCarePlan({
    organizationId: ORG,
    clientRef: CLIENT,
    milestoneId: "m1",
    milestoneAccepted: true,
    by: "person-1",
    at: AT,
    recorded,
  });
  if (!result.created) throw new Error(result.because);
  return result.plan;
}

describe("care plan", () => {
  it("does not open before the milestone is accepted", () => {
    const result = openCarePlan({
      organizationId: ORG,
      clientRef: CLIENT,
      milestoneId: "m1",
      milestoneAccepted: false,
      by: "person-1",
      at: AT,
    });
    expect(result.created).toBe(false);
  });

  it("opens once and returns the first plan on retry", () => {
    const first = plan();
    const again = openCarePlan({
      organizationId: ORG,
      clientRef: CLIENT,
      milestoneId: "m1",
      milestoneAccepted: true,
      by: "person-2",
      at: "2026-04-02T09:00:00.000Z",
      existing: [first],
    });
    expect(again).toMatchObject({ created: true, alreadyExisted: true });
    if (again.created) expect(again.plan.createdBy).toBe("person-1");
  });

  it("carries the four checklist items and names the gaps", () => {
    const care = plan({ care_owner: "Sam" });
    expect(care.checklist).toHaveLength(4);
    expect(careGaps(care)).toHaveLength(3);
  });

  it("starts unknown, not healthy", () => {
    expect(plan().health).toBe("unknown");
  });
});

describe("health reading", () => {
  it("stays unknown with no monitoring reference", () => {
    const reading = readCareHealth({
      plan: plan(),
      readings: [{ source: "uptime", observedAt: AT, state: "healthy", note: "" }],
    });
    expect(reading.health).toBe("unknown");
  });

  it("stays unknown when every source failed to read", () => {
    const reading = readCareHealth({
      plan: plan({ monitoring_references: "uptime board" }),
      readings: [{ source: "uptime", observedAt: AT, state: null, note: "timeout" }],
    });
    expect(reading.health).toBe("unknown");
    expect(reading.because).toContain("could not be read");
  });

  it("takes the worst state and flags a partial reading", () => {
    const reading = readCareHealth({
      plan: plan({ monitoring_references: "uptime board" }),
      readings: [
        { source: "uptime", observedAt: AT, state: "healthy", note: "" },
        { source: "errors", observedAt: AT, state: "incident", note: "" },
        { source: "logs", observedAt: AT, state: null, note: "timeout" },
      ],
    });
    expect(reading.health).toBe("incident");
    expect(reading.because).toContain("partial reading");
  });
});

describe("triage", () => {
  const events: HealthEvent[] = [
    { id: "e1", clientRef: CLIENT, source: "uptime", signature: "sig-a", occurredAt: "2026-04-01T09:00:00.000Z", summary: "the checkout page timing out" },
    { id: "e2", clientRef: CLIENT, source: "uptime", signature: "sig-a", occurredAt: "2026-04-01T11:00:00.000Z", summary: "the checkout page timing out" },
    { id: "e3", clientRef: "other-client", source: "uptime", signature: "sig-a", occurredAt: AT, summary: "someone else" },
  ];

  it("groups repeats into one suggestion and keeps other clients out", () => {
    const { suggestions } = triageFromEvents({ clientRef: CLIENT, events, ownerLabel: "Ops" });
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0]?.occurrences).toBe(2);
    expect(suggestions[0]?.eventIds).toEqual(["e1", "e2"]);
    expect(suggestions[0]?.needsPersonToAct).toBe(true);
  });

  it("refuses anything that would destroy or disrupt", () => {
    expect(suggestionIsPermitted("Restart the database")).toBe(false);
    expect(suggestionIsPermitted("Look at the slow query")).toBe(true);
  });
});

describe("outcome review", () => {
  const point = (over: Partial<MeasurePoint>): MeasurePoint => ({
    key: "qualified_meetings",
    label: "Qualified meetings",
    value: 10,
    unit: "count",
    tier: "observed",
    ...over,
  });

  it("names a missing figure instead of counting it as nought", () => {
    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: point({ value: null }),
      target: point({ value: 20 }),
      observed: point({ value: 15 }),
    });
    expect(review.movement).toBeNull();
    expect(review.notes.join(" ")).toContain("unknown, not nought");
  });

  it("compares baseline, target and observed when all are recorded", () => {
    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: point({ value: 4 }),
      target: point({ value: 10 }),
      observed: point({ value: 12, evidenceRef: "fixture:report/1" }),
    });
    expect(review.movement).toBe(8);
    expect(review.targetReached).toBe(true);
  });

  it("refuses to attribute value to a measure of output volume", () => {
    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: point({ key: "comms.drafts_prepared", value: 0 }),
      target: point({ key: "comms.drafts_prepared", value: 10 }),
      observed: point({ key: "comms.drafts_prepared", value: 12, evidenceRef: "fixture:report/1" }),
      attributed: { amountMinor: 500000, currency: "GBP", evidenceRef: "fixture:report/1" },
    });
    expect(review.attributedValue).toBeNull();
    expect(review.notes.join(" ")).toContain("not of what the client gained");
  });

  it("refuses attributed value with no evidence", () => {
    const review = reviewOutcome({
      clientRef: CLIENT,
      baseline: point({ value: 4 }),
      target: point({ value: 10 }),
      observed: point({ value: 12 }),
      attributed: { amountMinor: 500000, currency: "GBP" },
    });
    expect(review.attributedValue).toBeNull();
  });
});

describe("opportunity", () => {
  const review = reviewOutcome({
    clientRef: CLIENT,
    baseline: { key: "qualified_meetings", label: "Qualified meetings", value: 4, unit: "count", tier: "observed", evidenceRef: "fixture:baseline/1" },
    target: { key: "qualified_meetings", label: "Qualified meetings", value: 10, unit: "count", tier: "decided" },
    observed: { key: "qualified_meetings", label: "Qualified meetings", value: 12, unit: "count", tier: "observed", evidenceRef: "fixture:report/1" },
  });

  it("proposes from confirmed evidence with timing", () => {
    const result = proposeOpportunity({
      clientRef: CLIENT,
      mood: "settled",
      review,
      renewalDueAt: "2026-06-30T00:00:00.000Z",
      headline: "Extend the programme for another quarter",
    });
    expect(result.proposed).toBe(true);
    if (result.proposed) {
      expect(result.proposal.evidenceRefs.length).toBeGreaterThan(0);
      expect(result.proposal.timing).toContain("2026-06-30");
      expect(result.proposal.needsPersonToRaise).toBe(true);
    }
  });

  it("proposes nothing while a complaint is open", () => {
    const result = proposeOpportunity({
      clientRef: CLIENT,
      mood: "complaint_open",
      review,
      headline: "Extend the programme",
    });
    expect(result.proposed).toBe(false);
  });

  it("proposes nothing during service recovery", () => {
    const result = proposeOpportunity({
      clientRef: CLIENT,
      mood: "service_recovery",
      review,
      headline: "Extend the programme",
    });
    expect(result.proposed).toBe(false);
  });
});
