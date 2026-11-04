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

import { googleDocUrl, evidenceInput } from "./rfps";
it("canonicalizes Google Doc links without granting access or keeping tracking fragments", () => {
  expect(
    googleDocUrl("https://docs.google.com/document/d/abc_123/edit?usp=sharing#heading=x"),
  ).toBe("https://docs.google.com/document/d/abc_123/edit");
});
it.each([
  "https://docs.google.com.evil.test/document/d/abc/edit",
  "javascript:alert(1)",
  "https://evil@docs.google.com/document/d/abc/edit",
  "http://docs.google.com/document/d/abc/edit",
  "https://docs.google.com/document/d/e/abc/pub",
  "https://drive.google.com/folders/abc",
])("rejects non-document reference %s", (value) => {
  expect(() => googleDocUrl(value)).toThrow();
});
it("allows honest evidence gaps but requires a reason for an amendment", () => {
  const value = {
    draft_id: null,
    document_id: null,
    submitted_version: "",
    reference: "",
    evidence_url: "",
    reason: "Receipt still unavailable",
  };
  expect(evidenceInput.safeParse(value).success).toBe(true);
  expect(evidenceInput.safeParse({ ...value, reason: "" }).success).toBe(false);
});

import { submissionTimeLabel, submissionTimeFromForm } from "./rfps";
it("preserves minute precision without displaying invented seconds", () => {
  const value = { submitted_at: "2026-01-05T12:34:00Z", time_precision: "minute" as const };
  expect(submissionTimeLabel(value)).toContain("seconds unknown");
  expect(submissionTimeLabel(value)).not.toContain(":00");
  const input = { ...value, channel: "Email", reference: "", evidence_url: "", draft_id: null };
  expect(submissionInput.safeParse(input).success).toBe(true);
  expect(
    submissionInput.safeParse({ ...input, submitted_at: "2026-01-05T12:34:12Z" }).success,
  ).toBe(false);
});
it("represents date-only and unknown evidence without a fabricated instant", () => {
  const base = { channel: "Portal", reference: "", evidence_url: "", draft_id: null };
  expect(
    submissionInput.safeParse({
      ...base,
      submitted_at: null,
      submitted_date: "2026-01-05",
      time_precision: "date",
    }).success,
  ).toBe(true);
  expect(
    submissionInput.safeParse({
      ...base,
      submitted_at: null,
      submitted_date: "2026-02-30",
      time_precision: "date",
    }).success,
  ).toBe(false);
  expect(
    submissionInput.safeParse({ ...base, submitted_at: null, time_precision: "unknown" }).success,
  ).toBe(true);
  expect(
    submissionTimeLabel({
      submitted_at: null,
      submitted_date: "2026-01-05",
      time_precision: "date",
    }),
  ).toBe("2026-01-05 · date only; time unknown");
  expect(submissionTimeLabel({ submitted_at: "2026-01-05T12:34:56Z" })).toBe(
    "Submission time precision not recorded (legacy)",
  );
});
it("leaves timing untouched for an evidence-only amendment and clears unknown times", () => {
  const f = new FormData();
  f.set("time_precision", "unchanged");
  f.set("time", "2026-01-05T12:34");
  expect(submissionTimeFromForm(f)).toEqual({
    time_precision: null,
    submitted_at: null,
    submitted_date: null,
  });
  f.set("time_precision", "unknown");
  expect(submissionTimeFromForm(f).submitted_at).toBeNull();
});
