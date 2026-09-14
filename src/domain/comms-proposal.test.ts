import { describe, expect, it } from "vitest";

import {
  checkProposal,
  EMPTY_PROPOSAL,
  formatAmount,
  parseAmount,
  priceProposal,
  renderProposal,
  type ProposalSections,
} from "./comms-proposal";

const base: ProposalSections = {
  ...EMPTY_PROPOSAL,
  scope: "Rebuild the booking flow.",
  deliverables: ["Design", "Build"],
  lines: [
    { label: "Design", quantity: "2", unitPrice: "1200.50" },
    { label: "Build", quantity: "1", unitPrice: "3000" },
  ],
  assumptions: ["Content supplied by the client."],
  nextSteps: ["Confirm scope in writing."],
};

describe("proposal arithmetic", () => {
  it("adds money as exact minor units", () => {
    const maths = priceProposal(base);
    expect(parseAmount("1200.50", "GBP")).toBe(120050);
    expect(maths.subtotalMinor).toBe(120050 * 2 + 300000);
    expect(maths.totalMinor).toBe(maths.subtotalMinor);
    expect(formatAmount(540100, "GBP")).toBe("GBP 5,401.00");
  });

  it("never states a total while a line is unpriced", () => {
    const maths = priceProposal({
      ...base,
      lines: [...base.lines, { label: "Support", quantity: "", unitPrice: "" }],
    });
    expect(maths.subtotalMinor).toBeNull();
    expect(maths.totalMinor).toBeNull();
    expect(maths.unpriced).toContain("Support");
  });

  it("subtracts a discount and refuses one larger than the subtotal", () => {
    expect(priceProposal({ ...base, discount: "400" }).totalMinor).toBe(540100 - 40000);
    const issues = checkProposal({ ...base, discount: "9000" });
    expect(issues.some((issue) => issue.code === "discount_exceeds")).toBe(true);
  });

  it("is deterministic", () => {
    expect(priceProposal(base)).toEqual(priceProposal(base));
    expect(renderProposal(base)).toBe(renderProposal(base));
  });
});

describe("proposal checks", () => {
  it("names an empty scope and missing deliverables", () => {
    const issues = checkProposal({ ...EMPTY_PROPOSAL });
    expect(issues.map((issue) => issue.code)).toEqual(
      expect.arrayContaining(["scope_missing", "no_deliverables", "no_next_steps"]),
    );
  });

  it("flags two lines sharing a name", () => {
    const issues = checkProposal({
      ...base,
      lines: [...base.lines, { label: "design", quantity: "1", unitPrice: "10" }],
    });
    expect(issues.some((issue) => issue.code === "duplicate_line")).toBe(true);
  });
});

describe("rendered proposal", () => {
  it("renders exactly the structure, with the computed total", () => {
    const text = renderProposal(base);
    expect(text).toContain("Scope\nRebuild the booking flow.");
    expect(text).toContain("Total: GBP 5,401.00");
    expect(text).not.toMatch(/\$/);
  });

  it("says a total is not stated rather than inventing one", () => {
    const text = renderProposal({
      ...base,
      lines: [{ label: "Support", quantity: "", unitPrice: "" }],
    });
    expect(text).toContain("Total: not stated");
    expect(text).not.toMatch(/Total: GBP/);
  });
});
