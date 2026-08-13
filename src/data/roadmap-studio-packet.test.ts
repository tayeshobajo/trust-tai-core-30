/**
 * Studio packet and validation.
 *
 * These tests hold the line that makes Studio safe to point at a real client:
 * only approved thinking reaches the model, and only approved thinking survives
 * the model. Everything else is refused in the open rather than shipped.
 */

import { describe, expect, it } from "vitest";

import type {
  ArtifactSection,
  RoadmapMilestone,
  RoadmapStrategy,
  StrategyItem,
} from "@/domain/roadmap-intel";
import {
  buildEvidencePacket,
  NOT_READY_LINE,
  packetOutline,
  validateSections,
} from "./roadmap-studio-packet";

const CHECKED = "2026-01-05T00:00:00.000Z";
const source = { label: "About", url: "https://acme.com/about", checkedAt: CHECKED };

function item(overrides: Partial<StrategyItem> = {}): StrategyItem {
  return {
    key: "k",
    statement: "They serve regional operators.",
    because: "Stated on their own site.",
    tier: "decided",
    confidence: "high",
    sources: [source],
    approval: "approved",
    ...overrides,
  };
}

function strategy(overrides: Partial<RoadmapStrategy> = {}): RoadmapStrategy {
  return {
    id: "s1",
    organizationId: "org",
    roadmapId: "r1",
    pointA: [item({ key: "a" })],
    anchorProof: [item({ key: "anchor", statement: "Twelve years of field crews." })],
    horizon: [],
    pointB: item({ key: "b", statement: "Own the intake experience." }),
    pointC: item({ key: "c", statement: "Become the record system for the region." }),
    centralTruth: item({ key: "truth", statement: "The work is trusted, the front door is not." }),
    gaps: [item({ key: "gap", statement: "No competitor publishes real availability." })],
    leveragePoint: item({ key: "lev", statement: "Their crew data is already structured." }),
    createdAt: CHECKED,
    updatedAt: CHECKED,
    ...overrides,
  };
}

function milestone(overrides: Partial<RoadmapMilestone> = {}): RoadmapMilestone {
  return {
    id: "m1",
    organizationId: "org",
    roadmapId: "r1",
    name: "Client portal",
    whatWeBuild: "A portal",
    intendedUser: "Operations leads",
    supportingMarketDirection: "Self serve is expected",
    clientAdvantage: "They already own the data",
    currentGap: "Everything runs through email",
    evidence: [source],
    immediateValue: "Fewer email threads",
    longTermValue: "A data spine",
    dependencies: [],
    executionBoundary: "No billing integration",
    confidence: "high",
    priorityScore: 90,
    priorityRationale: [],
    recommendedSequence: 1,
    status: "approved",
    tier: "decided",
    createdAt: CHECKED,
    updatedAt: CHECKED,
    ...overrides,
  };
}

describe("buildEvidencePacket", () => {
  it("carries approved strategy and reports itself ready", () => {
    const packet = buildEvidencePacket({
      subjectLabel: "Acme",
      kind: "preview",
      strategy: strategy(),
      milestones: [],
    });
    expect(packet.ready).toBe(true);
    expect(packet.pointA).toHaveLength(1);
    expect(packet.allowedUrls).toContain(source.url);
  });

  it("refuses anything a person has not approved", () => {
    const packet = buildEvidencePacket({
      subjectLabel: "Acme",
      kind: "preview",
      strategy: strategy({
        pointA: [item({ key: "a", approval: "proposed", tier: "inferred" })],
        gaps: [item({ key: "gap", approval: "rejected" })],
      }),
      milestones: [],
    });
    expect(packet.pointA).toHaveLength(0);
    expect(packet.gaps).toHaveLength(0);
    expect(packet.ready).toBe(false);
    expect(packet.missing.join(" ")).toContain("Point A");
  });

  it("needs an approved milestone before a full roadmap can be argued", () => {
    const packet = buildEvidencePacket({
      subjectLabel: "Acme",
      kind: "full",
      strategy: strategy(),
      milestones: [milestone({ status: "candidate", tier: "inferred" })],
    });
    expect(packet.ready).toBe(false);
    expect(packet.missing.join(" ")).toContain("No milestone has been approved");
  });

  it("gives the full roadmap one page per approved milestone plus a close", () => {
    const packet = buildEvidencePacket({
      subjectLabel: "Acme",
      kind: "full",
      strategy: strategy(),
      milestones: [milestone(), milestone({ id: "m2", name: "Intake" })],
    });
    const keys = packetOutline(packet).map((page) => page.key);
    expect(keys.filter((key) => key.startsWith("milestone-"))).toHaveLength(2);
    expect(keys).toContain("closing");
    expect(keys).toContain("note-from-tai");
  });

  it("keeps the preview to the four page argument", () => {
    const packet = buildEvidencePacket({
      subjectLabel: "Acme",
      kind: "preview",
      strategy: strategy(),
      milestones: [milestone()],
    });
    expect(packetOutline(packet).map((page) => page.key)).toEqual([
      "title",
      "point-a",
      "market-gap",
      "note-from-tai",
    ]);
  });
});

describe("validateSections", () => {
  const packet = buildEvidencePacket({
    subjectLabel: "Acme",
    kind: "preview",
    strategy: strategy(),
    milestones: [],
  });

  function section(overrides: Partial<ArtifactSection> = {}): ArtifactSection {
    return {
      key: "point-a",
      title: "Point A",
      body: ["They serve regional operators, and that trust is already earned."],
      tier: "inferred",
      sources: [source],
      ...overrides,
    };
  }

  it("keeps a sourced line and promotes the page to decided", () => {
    const result = validateSections([section()], packet);
    expect(result.sections[0]?.tier).toBe("decided");
    expect(result.rejected).toHaveLength(0);
  });

  it("rejects an invented figure", () => {
    const result = validateSections(
      [section({ body: ["They grew revenue 42% last year."] })],
      packet,
    );
    expect(result.rejected[0]?.reason).toContain("42");
    expect(result.sections[0]?.body).toEqual([NOT_READY_LINE]);
    expect(result.sections[0]?.tier).toBe("inferred");
  });

  it("rejects interchangeable consulting language", () => {
    const result = validateSections(
      [section({ body: ["Acme is an industry-leading operator."] })],
      packet,
    );
    expect(result.rejected[0]?.reason).toContain("Interchangeable language");
  });

  it("drops a source the packet never cited", () => {
    const result = validateSections(
      [section({ sources: [{ label: "Made up", url: "https://elsewhere.com", checkedAt: CHECKED }] })],
      packet,
    );
    expect(result.sections[0]?.sources).toHaveLength(0);
    expect(result.rejected.some((entry) => entry.reason.includes("not in the approved"))).toBe(true);
  });

  it("strips em dashes rather than shipping them", () => {
    const result = validateSections(
      [section({ body: ["They serve regional operators — and it shows."] })],
      packet,
    );
    expect(result.sections[0]?.body.join(" ")).not.toContain("—");
  });

  it("says a page is not ready instead of writing around the gap", () => {
    const result = validateSections([section({ body: [] })], packet);
    expect(result.sections[0]?.body).toEqual([NOT_READY_LINE]);
  });
});
