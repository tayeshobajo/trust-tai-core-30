import { it, expect } from "vitest";
import { reviewSource } from "./rfp-intake";
import { opportunityInput } from "./rfps";
it("keeps unlabeled facts unknown and preserves source provenance", () => {
  const r = reviewSource({
    fileName: "Board RFP.docx",
    sha256: "a".repeat(64),
    text: "Website redesign\n$25,000 due soon",
  });
  expect(r.source_url).toBe("");
  expect(r.cycle).toBe("");
  expect(r.source_name).toBe("");
  expect(r.deadline_date).toBe("");
  expect(r.eligibility).toBe("unknown");
  expect(r.source_evidence).toContain("a".repeat(64));
  expect(opportunityInput.safeParse(r).success).toBe(true);
});
it("extracts only explicit labels and ISO date; no ambiguous timezone inferred", () => {
  const r = reviewSource({
    url: "https://example.org/rfp",
    text: "Title: Website refresh\nIssued by: Test Board\nRFP No: 2026-12\nDeadline: 2026-12-01",
  });
  expect(r).toMatchObject({
    title: "Website refresh",
    source_name: "Test Board",
    cycle: "2026-12",
    deadline_date: "2026-12-01",
    deadline_time: "",
    deadline_timezone: "",
  });
});
it("rejects a source-less record rather than inventing a URL", () => {
  expect(opportunityInput.safeParse(reviewSource({ text: "Website project" })).success).toBe(false);
});
it("bounds evidence and discloses truncation", () => {
  const r = reviewSource({ url: "https://example.org", text: "a".repeat(50000) });
  expect(r.source_evidence.length).toBeLessThan(20000);
  expect(r.source_evidence).toContain("truncated");
});
