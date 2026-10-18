/**
 * Integration tests for the staged workroom backend wiring:
 * - serverMeetingScore derives 100 ONLY from the consistent one-statement
 *   snapshot reporting `complete`; every partial/failed read is unknown,
 *   never a guess, and a number is never assembled from mixed reads.
 * - capability normalization maps every non-enabled state to unavailable.
 */

import { describe, expect, it } from "vitest";

import { serverMeetingScore } from "@/components/tt/steward/workroom-view";
import type { MeetingScoreRead } from "@/components/tt/steward/workroom-backend-panels";

const snapshotReady = (snapshot: {
  denominator: number;
  verified: number;
  pendingProposals: number;
  coverageCurrent: boolean;
  complete: boolean;
}): MeetingScoreRead => ({
  kind: "ready",
  snapshot: { ...snapshot, attestedAt: null, scopeVersion: 1 },
});

describe("serverMeetingScore", () => {
  it("returns null while the snapshot contract is unavailable (local derivation keeps working)", () => {
    expect(serverMeetingScore({ kind: "unavailable", reason: "off" })).toBeNull();
    expect(serverMeetingScore(undefined)).toBeNull();
  });

  it("is 100 only when the snapshot itself reports complete", () => {
    const score = serverMeetingScore(
      snapshotReady({
        denominator: 2,
        verified: 2,
        pendingProposals: 0,
        coverageCurrent: true,
        complete: true,
      }),
    );
    expect(score).toEqual({ value: 100, label: "All agreed work verified and coverage confirmed" });
  });

  it("never awards 100 when the snapshot is not complete, even if the parts look full", () => {
    /* complete is the durable SQL verdict; parts that look full but a
       non-complete snapshot must still cap below 100. */
    expect(
      serverMeetingScore(
        snapshotReady({
          denominator: 2,
          verified: 2,
          pendingProposals: 0,
          coverageCurrent: true,
          complete: false,
        }),
      )?.value,
    ).not.toBe(100);
    expect(
      serverMeetingScore(
        snapshotReady({
          denominator: 2,
          verified: 1,
          pendingProposals: 0,
          coverageCurrent: true,
          complete: false,
        }),
      )?.value,
    ).toBe(50);
    expect(
      serverMeetingScore(
        snapshotReady({
          denominator: 2,
          verified: 2,
          pendingProposals: 1,
          coverageCurrent: true,
          complete: false,
        }),
      )?.value,
    ).not.toBe(100);
  });

  it("zero scope is 0 with an honest label, never 100", () => {
    const score = serverMeetingScore(
      snapshotReady({
        denominator: 0,
        verified: 0,
        pendingProposals: 0,
        coverageCurrent: true,
        complete: false,
      }),
    );
    expect(score?.value).toBe(0);
    expect(score?.label).toContain("No agreed scope");
  });

  it("any failed or partial read is unknown, never a numeric guess", () => {
    expect(serverMeetingScore({ kind: "rejected", message: "read failed" })?.value).toBeNull();
    expect(serverMeetingScore({ kind: "loading" })?.value).toBeNull();
  });

  it("explains exactly what blocks 100", () => {
    const score = serverMeetingScore(
      snapshotReady({
        denominator: 3,
        verified: 1,
        pendingProposals: 2,
        coverageCurrent: false,
        complete: false,
      }),
    );
    expect(score?.label).toContain("2 not verified");
    expect(score?.label).toContain("coverage not confirmed");
    expect(score?.label).toContain("2 proposals pending");
  });
});
