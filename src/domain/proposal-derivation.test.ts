import { describe, expect, it } from "vitest";

import {
  deriveProposal,
  editLine,
  proposalReviewReadiness,
  quoteReadiness,
  rederiveAgainst,
  type CapacityCheck,
  type DerivedProposal,
  type PhaseEstimate,
} from "./proposal-derivation";
import {
  approveDestination,
  freezeRoadmapVersion,
  roadmapChanges,
  type PreparedRoadmap,
  type RoadmapVersion,
} from "./roadmap-preparation";

const AT = "2026-03-01T09:00:00.000Z";
const ORG = "org-fixture-0000-0000-0000-000000000001";

function baseRoadmap(): PreparedRoadmap {
  return {
    organizationId: ORG,
    clientRef: "fixture-client-01",
    pointA: [{ statement: "One person answers every enquiry.", tier: "observed", evidence: [] }],
    destination: { statement: "Every enquiry answered within a day.", tier: "inferred", evidence: [] },
    phases: [
      {
        id: "p1",
        position: 1,
        title: "Shared inbox",
        intent: "one place for enquiries",
        options: [{ id: "o1", label: "Move to a shared mailbox", because: "one owner", dependsOn: [] }],
        dependsOn: [],
        evidence: [],
      },
      {
        id: "p2",
        position: 2,
        title: "Reply templates",
        intent: "faster first replies",
        options: [{ id: "o2", label: "Three reusable replies", because: "repeatable", dependsOn: ["p1"] }],
        dependsOn: ["p1"],
        evidence: [],
      },
    ],
    firstMove: { statement: "Agree who owns the shared inbox.", tier: "inferred", evidence: [] },
    unknowns: ["Budget has not been discussed."],
  };
}

function frozen(roadmap: PreparedRoadmap = baseRoadmap(), existing: RoadmapVersion[] = []): RoadmapVersion {
  const approved = approveDestination({ roadmap, by: "person-1", at: AT });
  if (!approved.approved) throw new Error("expected approval");
  const outcome = freezeRoadmapVersion({ roadmap: approved.roadmap, by: "person-1", at: AT, existing });
  if (!outcome.frozen) throw new Error("expected freeze");
  return outcome.version;
}

const estimates: PhaseEstimate[] = [
  { phaseId: "p1", days: 4, currency: "GBP", amount: "2400.00", recordedBy: "person-1" },
  { phaseId: "p2", days: 3, currency: "GBP", amount: "1800.00", recordedBy: "person-1" },
];

const capacity: CapacityCheck[] = [
  { phaseId: "p1", checkedBy: "person-1", checkedAt: AT, canStartFrom: AT, note: "Two people free" },
  { phaseId: "p2", checkedBy: "person-1", checkedAt: AT, canStartFrom: null, note: "After phase one" },
];

describe("proposal derivation", () => {
  it("derives every section from exactly one roadmap version", () => {
    const version = frozen();
    const proposal = deriveProposal({ version, estimates, at: AT });
    expect(proposal.fromVersionId).toBe(version.versionId);
    expect(proposal.scope).toHaveLength(2);
    expect(proposal.exclusions[0]?.text).toContain("Budget has not been discussed");
    expect(proposal.deliverables).toHaveLength(2);
    expect(proposal.acceptanceCriteria).toHaveLength(2);
    expect(proposal.assumptions[0]?.text).toContain("assumes p1");
    expect(proposal.responsibilities).toHaveLength(2);
    expect(proposal.nextSteps[0]?.text).toBe("Agree who owns the shared inbox.");
    for (const entry of proposal.scope) expect(entry.fromVersionId).toBe(version.versionId);
  });

  it("adds up prices deterministically in one currency", () => {
    const proposal = deriveProposal({ version: frozen(), estimates, at: AT });
    expect(proposal.pricing.currency).toBe("GBP");
    expect(proposal.pricing.arithmetic?.totalMinor).toBe(420000);
    expect(proposal.pricing.unknownAmounts).toHaveLength(0);
  });

  it("names an unknown amount instead of counting it as nothing", () => {
    const proposal = deriveProposal({
      version: frozen(),
      estimates: [estimates[0]!],
      at: AT,
    });
    expect(proposal.pricing.arithmetic?.totalMinor).toBeNull();
    expect(proposal.pricing.unknownAmounts[0]).toContain("Reply templates");
  });

  it("refuses to add up amounts in different currencies", () => {
    const proposal = deriveProposal({
      version: frozen(),
      estimates: [estimates[0]!, { ...estimates[1]!, currency: "USD" }],
      at: AT,
    });
    expect(proposal.pricing.mixedCurrencies).toEqual(["GBP", "USD"]);
    expect(proposal.pricing.arithmetic).toBeNull();
  });

  it("requires an estimate and a capacity check before dates or prices are approved", () => {
    const version = frozen();
    expect(quoteReadiness({ version, estimates, capacity }).ready).toBe(true);
    const short = quoteReadiness({ version, estimates, capacity: [capacity[0]!] });
    expect(short.ready).toBe(false);
    expect(short.missing[0]).toContain("No capacity check for Reply templates");
    const noEstimate = quoteReadiness({ version, estimates: [], capacity });
    expect(noEstimate.missing).toHaveLength(2);
  });

  it("keeps a human edit when the roadmap moves, and says what changed", () => {
    const first = frozen();
    let proposal: DerivedProposal = deriveProposal({ version: first, estimates, at: AT });
    proposal = editLine(proposal, "scope", 0, "Shared inbox, owned by Tai's team.");

    const edited = structuredClone(first.roadmap);
    edited.phases[1]!.intent = "faster replies and fewer misses";
    const next = frozen(edited, [first]);
    const changes = roadmapChanges(first, next);

    const result = rederiveAgainst({
      proposal,
      previousVersion: first,
      nextVersion: next,
      estimates,
      at: "2026-03-05T09:00:00.000Z",
      changes,
    });

    expect(result.keptHumanEdits).toContain("Shared inbox, owned by Tai's team.");
    expect(result.proposal.scope[0]?.text).toBe("Shared inbox, owned by Tai's team.");
    expect(result.proposal.scope[0]?.editedByPerson).toBe(true);
    expect(result.changes[0]?.what).toBe("Phase Reply templates");
    expect(result.reviewReadinessWithdrawn).toBe(true);
  });

  it("withdraws review readiness while the proposal is behind the roadmap", () => {
    const first = frozen();
    const proposal = deriveProposal({ version: first, estimates, at: AT });
    const readiness = quoteReadiness({ version: first, estimates, capacity });
    expect(proposalReviewReadiness({ proposal, currentVersion: first, readiness }).ready).toBe(true);

    const edited = structuredClone(first.roadmap);
    edited.phases[0]!.intent = "one place for enquiries and calls";
    const next = frozen(edited, [first]);
    const behind = proposalReviewReadiness({
      proposal,
      currentVersion: next,
      readiness: quoteReadiness({ version: next, estimates, capacity }),
    });
    expect(behind.ready).toBe(false);
    expect(behind.missing.join(" ")).toContain("newer approved version");
  });
});

describe("save and reload one approved roadmap and its proposal", () => {
  it("reloads the same version, the same stamp and the same traceability", () => {
    const version = frozen();
    const proposal = deriveProposal({ version, estimates, at: AT });

    // A synthetic store. Save as text, read back as text, compare exactly.
    const store = new Map<string, string>();
    store.set(`version:${version.versionId}`, JSON.stringify(version));
    store.set(`proposal:${version.versionId}`, JSON.stringify(proposal));

    const reloadedVersion = JSON.parse(store.get(`version:${version.versionId}`)!) as RoadmapVersion;
    const reloadedProposal = JSON.parse(store.get(`proposal:${version.versionId}`)!) as DerivedProposal;

    expect(reloadedVersion.stamp).toBe(version.stamp);
    expect(reloadedProposal.fromVersionId).toBe(reloadedVersion.versionId);
    expect(reloadedProposal.fromVersionStamp).toBe(reloadedVersion.stamp);
    expect(reloadedProposal.pricing.arithmetic?.totalMinor).toBe(420000);
    for (const entry of [...reloadedProposal.scope, ...reloadedProposal.acceptanceCriteria]) {
      expect(entry.fromVersionId).toBe(reloadedVersion.versionId);
      expect(
        reloadedVersion.roadmap.phases.some((phase) => phase.id === entry.fromPhaseId),
      ).toBe(true);
    }
    expect(
      proposalReviewReadiness({
        proposal: reloadedProposal,
        currentVersion: reloadedVersion,
        readiness: quoteReadiness({ version: reloadedVersion, estimates, capacity }),
      }).ready,
    ).toBe(true);
  });
});
