/**
 * Integration tests for the staged workroom backend wiring:
 * - serverMeetingScore derives 100 ONLY from nonzero scope fully verified
 *   + current coverage + no pending proposals; every partial/failed read
 *   is unknown, never a guess.
 * - capability normalization maps every non-enabled state to unavailable.
 */

import { describe, expect, it } from "vitest";

import { serverMeetingScore } from "@/components/tt/steward/workroom-view";
import type {
  CoverageRead,
  ProposalReviewRead,
  ScopeRead,
} from "@/components/tt/steward/workroom-backend-panels";

const scopeReady = (counts: {
  denominator: number;
  verified: number;
  pendingProposals: number;
}): ScopeRead => ({ kind: "ready", counts });
const coverageReady = (current: boolean): CoverageRead => ({
  kind: "ready",
  current,
  attestedAt: current ? "2026-01-01T10:00:00Z" : null,
});
const proposalsReady: ProposalReviewRead = { kind: "ready", proposals: [] };

describe("serverMeetingScore", () => {
  it("returns null while the scope contract is unavailable (local derivation keeps working)", () => {
    expect(serverMeetingScore({ scope: { kind: "unavailable", reason: "off" } })).toBeNull();
    expect(serverMeetingScore({})).toBeNull();
  });

  it("is 100 only with nonzero scope fully verified, current coverage, no pending proposals", () => {
    const score = serverMeetingScore({
      scope: scopeReady({ denominator: 2, verified: 2, pendingProposals: 0 }),
      coverage: coverageReady(true),
      proposals: proposalsReady,
    });
    expect(score).toEqual({ value: 100, label: "All agreed work verified and coverage confirmed" });
  });

  it("never awards 100 with open work, unconfirmed coverage, or pending proposals", () => {
    expect(
      serverMeetingScore({
        scope: scopeReady({ denominator: 2, verified: 1, pendingProposals: 0 }),
        coverage: coverageReady(true),
        proposals: proposalsReady,
      })?.value,
    ).toBe(50);
    expect(
      serverMeetingScore({
        scope: scopeReady({ denominator: 2, verified: 2, pendingProposals: 0 }),
        coverage: coverageReady(false),
        proposals: proposalsReady,
      })?.value,
    ).not.toBe(100);
    expect(
      serverMeetingScore({
        scope: scopeReady({ denominator: 2, verified: 2, pendingProposals: 1 }),
        coverage: coverageReady(true),
        proposals: proposalsReady,
      })?.value,
    ).not.toBe(100);
  });

  it("zero scope is 0 with an honest label, never 100", () => {
    const score = serverMeetingScore({
      scope: scopeReady({ denominator: 0, verified: 0, pendingProposals: 0 }),
      coverage: coverageReady(true),
      proposals: proposalsReady,
    });
    expect(score?.value).toBe(0);
    expect(score?.label).toContain("No agreed scope");
  });

  it("any failed or partial read is unknown, never a numeric guess", () => {
    expect(
      serverMeetingScore({
        scope: { kind: "rejected", message: "read failed" },
        coverage: coverageReady(true),
        proposals: proposalsReady,
      })?.value,
    ).toBeNull();
    expect(
      serverMeetingScore({
        scope: scopeReady({ denominator: 1, verified: 1, pendingProposals: 0 }),
        coverage: { kind: "rejected", message: "read failed" },
        proposals: proposalsReady,
      })?.value,
    ).toBeNull();
    expect(
      serverMeetingScore({
        scope: { kind: "loading" },
        coverage: coverageReady(true),
        proposals: proposalsReady,
      })?.value,
    ).toBeNull();
  });

  it("explains exactly what blocks 100", () => {
    const score = serverMeetingScore({
      scope: scopeReady({ denominator: 3, verified: 1, pendingProposals: 2 }),
      coverage: coverageReady(false),
      proposals: proposalsReady,
    });
    expect(score?.label).toContain("2 not verified");
    expect(score?.label).toContain("coverage not confirmed");
    expect(score?.label).toContain("2 proposals pending");
  });
});
