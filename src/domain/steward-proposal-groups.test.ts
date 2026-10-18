import { describe, expect, it } from "vitest";

import type { Proposal } from "./steward";
import { groupRelatedProposals } from "./steward-proposal-groups";

let n = 0;
function proposal(statement: string, quote = statement): Proposal {
  n += 1;
  return {
    id: `p${n}`,
    kind: "action",
    statement,
    quote,
    tier: "proposed",
    confidence: "medium",
    at: `00:39:${48 + n}`,
    ownerName: null,
    ownerResolved: false,
    dueText: null,
    evidence: [],
  } as Proposal;
}

describe("proposal overlap grouping", () => {
  it("clusters passages that describe the same work, preserving every source", () => {
    const groups = groupRelatedProposals([
      proposal("Build the phased artist-growth roadmap for the label"),
      proposal("Create the phased artist-growth roadmap for the label"),
      proposal("Deliver the phased artist-growth roadmap for the label"),
      proposal("Design the artist website mockup"),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.proposals).toHaveLength(3);
    expect(groups[0]!.because).toContain("same action");
  });

  it("never groups across kinds and never groups distinct work", () => {
    const groups = groupRelatedProposals([
      proposal("Build the phased artist-growth roadmap for the label"),
      proposal("Design the artist website mockup for the launch page"),
    ]);
    expect(groups).toHaveLength(0);
  });

  it("is read-only: grouping returns no confirmation or merge instruction", () => {
    const groups = groupRelatedProposals([
      proposal("Build the phased artist-growth roadmap for the label"),
      proposal("Create the phased artist-growth roadmap for the label"),
    ]);
    expect(Object.keys(groups[0]!).sort()).toEqual(["because", "key", "proposals"]);
  });
});
