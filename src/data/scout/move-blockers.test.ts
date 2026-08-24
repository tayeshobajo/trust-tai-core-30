/**
 * The guided blocker flow behind "Resolve N blockers", proved piece by piece:
 * every blocker kind maps to exactly one truthful next action, progress is
 * counted honestly, and the flow hands over to the first message only when
 * the move itself has advanced.
 */

import { describe, expect, it } from "vitest";

import type { Person } from "@/domain/people";
import type { ResearchCoverage } from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";

import { advanceAfterBlockers, blockerProgress, buildMoveBlockers } from "./move-blockers";

const claire = {
  id: "person-1",
  fullName: "Claire Meneely",
  roleTitle: "Founder",
  email: "claire@dozen.example",
  emailStatus: "found",
  confidence: "asserted_by_provider",
  decisionMakerLikelihood: "high",
  sourceId: "website-pages",
} as unknown as Person;

const candidate = (over: { scoreable?: boolean } = {}): ProspectCandidate =>
  ({
    prospect: { id: "p1", name: "Dozen Bakery", status: "discovered" },
    evaluation: { scoreable: over.scoreable ?? true, score: 86, light: "green" },
  }) as unknown as ProspectCandidate;

const full = { thin: false } as ResearchCoverage;
const thin = { thin: true } as ResearchCoverage;

describe("buildMoveBlockers", () => {
  it("an unverified email gets the inline confirm action, bound to its person", () => {
    const blockers = buildMoveBlockers({ candidate: candidate(), people: [claire], coverage: full });
    const email = blockers.find((blocker) => block.key.startsWith("email_unverified"));
    expect(email).toBeDefined();
    expect(email!.action.kind).toBe("confirm_email");
    expect(email!.action.label).toBe("Confirm this address");
    expect(email!.person?.id).toBe("person-1");
    expect(email!.detail).toContain("confirms the address is real");
  });

  it("thin or missing research gets the inline governed research pass", () => {
    const thinBlockers = buildMoveBlockers({ candidate: candidate(), people: [claire], coverage: thin });
    const coverageRow = thinBlockers.find((blocker) => block.key === "thin_coverage");
    expect(coverageRow!.action.kind).toBe("run_research");
    expect(coverageRow!.action.label).toBe("Refresh the company read");

    const unscored = buildMoveBlockers({
      candidate: candidate({ scoreable: false }),
      people: [claire],
      coverage: full,
    });
    const scoreRow = unscored.find((blocker) => block.key === "not_scored");
    expect(scoreRow!.action.kind).toBe("run_research");
    expect(scoreRow!.action.label).toBe("Research this company");
  });

  it("people gaps deep-link into the People workspace", () => {
    const withoutEmail = {
      ...claire,
      email: undefined,
      emailStatus: "unknown",
      roleTitle: undefined,
      decisionMakerLikelihood: "low",
    } as unknown as Person;
    const blockers = buildMoveBlockers({
      candidate: candidate(),
      people: [withoutEmail],
      coverage: full,
    });
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.every((blocker) => block.action.kind === "open_people")).toBe(true);
    const roleRow = blockers.find((blocker) => block.key.startsWith("no_role"));
    expect(roleRow?.person?.id).toBe("person-1");
  });

  it("keys are stable and unique across several blockers", () => {
    const blockers = buildMoveBlockers({ candidate: candidate(), people: [claire], coverage: thin });
    expect(blockers.length).toBeGreaterThan(1);
    expect(new Set(blockers.map((blocker) => block.key)).size).toBe(blockers.length);
  });

  it("a clear handoff means no flow", () => {
    const verified = { ...claire, emailStatus: "verified" } as unknown as Person;
    expect(buildMoveBlockers({ candidate: candidate(), people: [verified], coverage: full })).toEqual([]);
  });
});

describe("blockerProgress", () => {
  it("counts what has cleared, never below zero", () => {
    expect(blockerProgress(2, 2)).toEqual({ resolved: 0, total: 2, done: false });
    expect(blockerProgress(2, 1)).toEqual({ resolved: 1, total: 2, done: false });
    expect(blockerProgress(2, 0)).toEqual({ resolved: 2, total: 2, done: true });
    expect(blockerProgress(0, 0)).toEqual({ resolved: 0, total: 0, done: false });
    expect(blockerProgress(3, 5)).toEqual({ resolved: 0, total: 3, done: false });
  });
});

describe("advanceAfterBlockers", () => {
  it("advances only from an open flow into an earned first message", () => {
    expect(
      advanceAfterBlockers({ flowOpen: true, firstMessageReady: true, primaryKind: "prepare_first_message" }),
    ).toBe(true);
    expect(
      advanceAfterBlockers({ flowOpen: true, firstMessageReady: false, primaryKind: "resolve_blockers" }),
    ).toBe(false);
    expect(
      advanceAfterBlockers({ flowOpen: false, firstMessageReady: true, primaryKind: "prepare_first_message" }),
    ).toBe(false);
    expect(
      advanceAfterBlockers({ flowOpen: true, firstMessageReady: true, primaryKind: "prepare_research" }),
    ).toBe(false);
  });
});
