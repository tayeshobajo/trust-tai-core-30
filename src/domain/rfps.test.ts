import { describe, it, expect } from "vitest";
import {
  canonicalSource,
  opportunityInput,
  blankOpportunity,
  deadlineLabel,
  filterOpportunities,
  submissionInput,
  validateUpload,
  type Opportunity,
} from "./rfps";
describe("RFP domain truth", () => {
  it("deduplicates tracking variants while preserving solicitation query keys", () => {
    expect(
      canonicalSource("https://example.org/apply/?id=12&utm_source=email&mc_eid=abc#top"),
    ).toBe("https://example.org/apply?id=12");
    expect(() => canonicalSource("javascript:alert(1)")).toThrow();
  });
  it("preserves unknown eligibility and deadline and requires provenance", () => {
    expect(deadlineLabel(blankOpportunity)).toBe("Deadline unknown");
    expect(opportunityInput.safeParse(blankOpportunity).success).toBe(false);
  });
  it("requires timezone for precise deadline", () => {
    const input = {
      ...blankOpportunity,
      title: "Test only",
      source_name: "Test issuer",
      source_url: "https://example.org",
      cycle: "2026",
      source_evidence: "Test evidence",
      deadline_date: "2026-11-17",
      deadline_time: "17:00",
    };
    expect(opportunityInput.safeParse(input).success).toBe(false);
    expect(
      opportunityInput.safeParse({ ...input, deadline_timezone: "America/Chicago" }).success,
    ).toBe(true);
  });
  it("filters stage and type consistently and sorts unknown dates last", () => {
    const row = {
      ...blankOpportunity,
      title: "Test",
      id: "1",
      stage: "captured",
      deadline_date: "",
    } as Opportunity;
    expect(
      filterOpportunities(
        [row, { ...row, id: "2", deadline_date: "2026-11-17" }],
        "",
        "all",
        "rfp",
      ).map((o) => o.id),
    ).toEqual(["2", "1"]);
    expect(filterOpportunities([row], "", "submitted", "all")).toHaveLength(0);
  });
  it("rejects future submission and unsafe evidence", () => {
    expect(
      submissionInput.safeParse({
        submitted_at: "2999-01-01T00:00:00Z",
        channel: "Portal",
        reference: "",
        evidence_url: "",
        draft_id: null,
      }).success,
    ).toBe(false);
  });
  it("limits uploads to bounded document formats", () => {
    expect(() => validateUpload({ name: "x.html", size: 30, type: "text/html" })).toThrow();
    expect(() =>
      validateUpload({ name: "x.pdf", size: 21 * 1024 * 1024, type: "application/pdf" }),
    ).toThrow();
    expect(() =>
      validateUpload({ name: "x.pdf", size: 30, type: "application/pdf" }),
    ).not.toThrow();
  });
});
