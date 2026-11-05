import { describe, it, expect } from "vitest";
import { blankOpportunity, type Opportunity, type Submission } from "./rfps";
import { recordedDeadlinePassed, hiddenPastRfpIds, safeSourceLink } from "./rfp-visibility";
const row = {
  ...blankOpportunity,
  id: "r",
  kind: "rfp",
  stage: "captured",
  deadline_date: "2026-11-05",
} as Opportunity;
describe("date-aware RFP display", () => {
  it("keeps unknown, invalid and due-today dates visible", () => {
    const now = new Date("2026-11-05T18:00:00Z");
    for (const date of ["", "invalid", "2026-02-30", "2026-11-05", "2026-11-06"])
      expect(recordedDeadlinePassed({ ...row, deadline_date: date }, now)).toBe(false);
  });
  it("does not guess a timezone for date-only records", () => {
    expect(recordedDeadlinePassed(row, new Date("2026-11-06T11:59:00Z"))).toBe(false);
    expect(recordedDeadlinePassed(row, new Date("2026-11-06T12:00:00Z"))).toBe(true);
    expect(
      recordedDeadlinePassed(
        { ...row, deadline_date: "2026-10-21" },
        new Date("2026-11-05T00:00:00Z"),
      ),
    ).toBe(true);
  });
  it("uses the source timezone for date-only rollover", () => {
    const r = { ...row, deadline_timezone: "America/Chicago" };
    expect(recordedDeadlinePassed(r, new Date("2026-11-06T05:59:00Z"))).toBe(false);
    expect(recordedDeadlinePassed(r, new Date("2026-11-06T06:00:00Z"))).toBe(true);
  });
  it("compares exact deadlines in source timezone, independently of viewer zone", () => {
    const r = { ...row, deadline_time: "16:00", deadline_timezone: "America/Chicago" };
    expect(recordedDeadlinePassed(r, new Date("2026-11-05T21:59:00Z"))).toBe(false);
    expect(recordedDeadlinePassed(r, new Date("2026-11-05T22:00:00Z"))).toBe(true);
  });
  it("keeps ambiguous fall-back minutes until their later occurrence and rejects nonexistent times", () => {
    const r = {
      ...row,
      deadline_date: "2026-11-01",
      deadline_time: "01:30",
      deadline_timezone: "America/New_York",
    };
    expect(recordedDeadlinePassed(r, new Date("2026-11-01T05:45:00Z"))).toBe(false);
    expect(recordedDeadlinePassed(r, new Date("2026-11-01T06:30:00Z"))).toBe(true);
    expect(
      recordedDeadlinePassed(
        { ...r, deadline_date: "2026-03-08", deadline_time: "02:30" },
        new Date("2026-11-05T00:00:00Z"),
      ),
    ).toBe(false);
  });
  it("preserves invalid timezone and malformed time uncertainty", () => {
    const now = new Date("2026-12-01T00:00:00Z");
    expect(recordedDeadlinePassed({ ...row, deadline_timezone: "Unknown/Zone" }, now)).toBe(false);
    expect(
      recordedDeadlinePassed(
        { ...row, deadline_timezone: "America/Chicago", deadline_time: "99:00" },
        now,
      ),
    ).toBe(false);
  });
  it("retains actual submissions even when stage differs, all submitted outcomes, and grants", () => {
    const old = { ...row, deadline_date: "2026-10-01" };
    const rows = [
      old,
      ...(["submitted", "awarded", "declined"] as const).map((stage) => ({
        ...old,
        id: stage,
        stage,
      })),
      { ...old, id: "grant", kind: "grant" as const },
      { ...old, id: "recorded" },
    ];
    expect([
      ...hiddenPastRfpIds(
        rows,
        [{ opportunity_id: "recorded" } as Submission],
        new Date("2026-11-05T12:00:00Z"),
      ),
    ]).toEqual(["r"]);
    expect(old.stage).toBe("captured");
  });
  it("allows only safe HTTP source links", () => {
    expect(safeSourceLink("https://example.org/rfp")).toBe("https://example.org/rfp");
    for (const url of [
      "",
      "javascript:alert(1)",
      "data:text/html,bad",
      "https://user:pass@example.org",
    ])
      expect(safeSourceLink(url)).toBeNull();
  });
});
