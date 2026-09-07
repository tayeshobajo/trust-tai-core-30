import { describe, expect, it } from "vitest";

import {
  NO_EVIDENCE,
  checkEvidenceInput,
  criterionEvidencePath,
  evidenceEventKey,
  evidenceFor,
  evidenceRequired,
  evidenceSummary,
  type CriterionEvidence,
} from "./criterion-evidence";

function evidence(over: Partial<CriterionEvidence> = {}): CriterionEvidence {
  return {
    id: "e1",
    organizationId: "org",
    roadmapId: "road",
    milestoneId: "mile",
    criterionId: "crit",
    type: "note",
    label: "Checked the staging page",
    createdBy: "user",
    createdAt: "2026-09-01T10:00:00.000Z",
    ...over,
  };
}

describe("criterion evidence input", () => {
  it("refuses a link that is not somewhere a colleague could open", () => {
    const checked = checkEvidenceInput({ type: "link", url: "staging" });
    expect(checked.ok).toBe(false);
  });

  it("accepts a link and falls back to the address as its label", () => {
    const checked = checkEvidenceInput({ type: "link", url: " https://example.com/page " });
    expect(checked).toEqual({
      ok: true,
      input: { type: "link", label: "https://example.com/page", url: "https://example.com/page" },
    });
  });

  it("refuses an empty note and keeps a written one", () => {
    expect(checkEvidenceInput({ type: "note", note: "  " }).ok).toBe(false);
    const checked = checkEvidenceInput({ type: "note", note: "Client approved on the call" });
    expect(checked.ok && checked.input.label).toBe("Client approved on the call");
  });

  it("refuses a file with nothing chosen", () => {
    expect(checkEvidenceInput({ type: "file" }).ok).toBe(false);
    expect(checkEvidenceInput({ type: "file", label: "proof.png" }).ok).toBe(true);
  });
});

describe("criterion evidence reading", () => {
  it("shows absence as absence", () => {
    expect(evidenceSummary([])).toBe(NO_EVIDENCE);
    expect(evidenceSummary([evidence()])).toBe("1 evidence item");
    expect(evidenceSummary([evidence(), evidence({ id: "e2" })])).toBe("2 evidence items");
  });

  it("keeps evidence scoped to its own criterion", () => {
    const rows = [evidence(), evidence({ id: "e2", criterionId: "other" })];
    expect(evidenceFor(rows, "crit").map((row) => row.id)).toEqual(["e1"]);
  });

  it("never requires evidence while no canonical rule decides that", () => {
    expect(evidenceRequired({ id: "crit" })).toBe(false);
  });
});

describe("replay safety and storage", () => {
  it("gives the same key to the same proof twice", () => {
    const input = { type: "link" as const, label: "Page", url: "https://example.com/a" };
    expect(evidenceEventKey("crit", input)).toBe(evidenceEventKey("crit", input));
    expect(evidenceEventKey("crit", input)).not.toBe(evidenceEventKey("other", input));
  });

  it("scopes every stored file under the owning organization", () => {
    const path = criterionEvidencePath("org", "mile", "crit", "screen shot.png");
    expect(path.startsWith("org/criterion-evidence/mile/crit/")).toBe(true);
    expect(path.endsWith("-screen-shot.png")).toBe(true);
  });
});
