import { describe, expect, it } from "vitest";

import { renderProposal, type ProposalSections } from "./comms-proposal";
import {
  emptyProposal,
  proposalHasContent,
  PROPOSAL_SCHEMA_VERSION,
  readStructuredSource,
  structuredProposalSource,
  validateProposalSections,
} from "./comms-proposal-source";

const good: ProposalSections = {
  currency: "GBP",
  scope: "Rebuild the booking flow.",
  deliverables: ["Design", "Build"],
  lines: [{ label: "Design", quantity: "2", unitPrice: "1200.50" }],
  assumptions: [],
  nextSteps: ["Confirm scope."],
  discount: "",
};

describe("proposal structure validation", () => {
  it("accepts a well-formed structure unchanged", () => {
    const checked = validateProposalSections(good);
    expect(checked.ok && checked.sections).toEqual(good);
  });

  it("refuses an unknown currency, a bad number and a malformed shape", () => {
    expect(validateProposalSections({ ...good, currency: "XBT" }).ok).toBe(false);
    expect(
      validateProposalSections({ ...good, lines: [{ label: "x", quantity: "two", unitPrice: "1" }] })
        .ok,
    ).toBe(false);
    expect(validateProposalSections({ ...good, discount: "-" }).ok).toBe(false);
    expect(validateProposalSections({ ...good, deliverables: "Design" }).ok).toBe(false);
    expect(validateProposalSections(null).ok).toBe(false);
  });

  it("refuses more than it can store", () => {
    const many = Array.from({ length: 500 }, (_, index) => `Item ${index}`);
    expect(validateProposalSections({ ...good, deliverables: many }).ok).toBe(false);
    expect(validateProposalSections({ ...good, scope: "x".repeat(20_000) }).ok).toBe(false);
  });
});

describe("structured source round trip", () => {
  it("renders canonically and reads back the same sections", () => {
    const source = structuredProposalSource(good);
    expect(source.schemaVersion).toBe(PROPOSAL_SCHEMA_VERSION);
    expect(source.renderedText).toBe(renderProposal(good));

    const back = readStructuredSource(JSON.parse(JSON.stringify(source)));
    expect(back?.sections).toEqual(good);
    expect(back?.renderedText).toBe(source.renderedText);
  });

  it("reads a structure whose stored text disagrees with its sections as not reconstructable", () => {
    const source = { ...structuredProposalSource(good), renderedText: "Something else entirely." };
    expect(readStructuredSource(source)).toBeNull();
  });

  it("reads an unknown schema version or a missing structure as not reconstructable", () => {
    expect(readStructuredSource({ ...structuredProposalSource(good), schemaVersion: 99 })).toBeNull();
    expect(readStructuredSource(null)).toBeNull();
    expect(readStructuredSource({ kind: "message" })).toBeNull();
  });
});

describe("emptiness", () => {
  it("an untouched proposal is not unsaved writing", () => {
    expect(proposalHasContent(emptyProposal())).toBe(false);
    expect(renderProposal(emptyProposal())).toBe("");
    expect(proposalHasContent({ ...emptyProposal(), scope: " " })).toBe(false);
    expect(proposalHasContent({ ...emptyProposal(), scope: "Work" })).toBe(true);
  });
});
