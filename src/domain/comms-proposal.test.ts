import { describe, expect, it } from "vitest";

import {
  checkProposal,
  EMPTY_PROPOSAL,
  formatAmount,
  minorUnits,
  parseAmount,
  PROPOSAL_CURRENCIES,
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

describe("the stated worked example", () => {
  const sections = {
    ...EMPTY_PROPOSAL,
    currency: "USD",
    scope: "Two workshops and a handover.",
    deliverables: ["Workshops", "Handover guide"],
    lines: [
      { label: "Workshop", quantity: "2", unitPrice: "125.50" },
      { label: "Handover", quantity: "1", unitPrice: "249.00" },
    ],
    assumptions: [],
    nextSteps: ["Confirm dates"],
    discount: "50.00",
  };

  it("two at 125.50 plus one at 249.00 less 50.00 is USD 450.00", () => {
    const maths = priceProposal(sections);
    expect(maths.subtotalMinor).toBe(50_000);
    expect(maths.discountMinor).toBe(5_000);
    expect(maths.totalMinor).toBe(45_000);
    expect(formatAmount(maths.totalMinor ?? 0, "USD")).toBe("USD 450.00");
  });

  it("a blank price leaves the total unknown rather than smaller", () => {
    const missing = {
      ...sections,
      lines: [sections.lines[0]!, { label: "Handover", quantity: "1", unitPrice: "" }],
    };
    const maths = priceProposal(missing);
    expect(maths.totalMinor).toBeNull();
    expect(maths.unpriced).toEqual(["Handover"]);
    expect(
      checkProposal(missing).some((issue) => issue.code === "unpriced_line" && issue.blocking),
    ).toBe(true);
  });

  it("every currency this workspace prices in is a two-decimal one", () => {
    /* P3.4 names zero-decimal currencies. None are offered, so the claim is
       checked rather than assumed: if one is ever added, this fails and the
       parsing and formatting rules must be revisited with it. */
    for (const currency of PROPOSAL_CURRENCIES) expect(minorUnits(currency)).toBe(100);
  });

  it("cannot mix currencies, because a proposal carries exactly one", () => {
    const priced = priceProposal({ ...sections, currency: "GBP" });
    expect(priced.currency).toBe("GBP");
    expect(priced.lines.every((line) => line.minor !== null)).toBe(true);
  });
});
