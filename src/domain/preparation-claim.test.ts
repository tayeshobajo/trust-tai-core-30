import { describe, expect, it } from "vitest";

import { claimDecision, leaseExpired, leaseUntil } from "@/domain/preparation-claim";

const nowIso = "2026-09-16T10:00:00.000Z";
const base = { nowIso, maxAttempts: 3 };

describe("claiming an attempt", () => {
  it("claims a subject nothing has been prepared for", () => {
    expect(claimDecision({ ...base, existing: null })).toEqual({
      act: "claim",
      attempts: 1,
      because: expect.any(String),
    });
  });

  it("returns finished work instead of preparing it twice", () => {
    for (const status of ["prepared", "needs_decision"] as const) {
      expect(
        claimDecision({ ...base, existing: { status, attempts: 1 } }).act,
      ).toBe("return_existing");
    }
  });

  it("refuses while another attempt still holds the lease", () => {
    const read = claimDecision({
      ...base,
      existing: {
        status: "running",
        attempts: 1,
        leaseUntil: "2026-09-16T10:04:00.000Z",
        attemptId: "attempt-1",
      },
    });
    expect(read).toEqual({ act: "refuse", status: "running", because: expect.any(String) });
  });

  it("recovers a run whose worker stopped, without losing the attempt count", () => {
    const read = claimDecision({
      ...base,
      existing: {
        status: "running",
        attempts: 1,
        leaseUntil: "2026-09-16T09:59:00.000Z",
        attemptId: "attempt-1",
      },
    });
    expect(read).toEqual({ act: "claim", attempts: 2, because: expect.any(String) });
  });

  it("never picks up an unknown outcome or a stopped run by itself", () => {
    expect(claimDecision({ ...base, existing: { status: "uncertain", attempts: 1 } }).act).toBe(
      "refuse",
    );
    expect(claimDecision({ ...base, existing: { status: "cancelled", attempts: 1 } }).act).toBe(
      "refuse",
    );
  });

  it("stops at the attempt limit", () => {
    const read = claimDecision({
      ...base,
      existing: { status: "could_not_finish", attempts: 3 },
    });
    expect(read.act).toBe("refuse");
    expect(read.because).toContain("Tried 3 times");
  });

  it("refuses a record something has already revoked", () => {
    const read = claimDecision({
      ...base,
      existing: {
        status: "could_not_finish",
        attempts: 1,
        supersededBecause: "The source note was withdrawn.",
      },
    });
    expect(read).toEqual({
      act: "refuse",
      status: "could_not_finish",
      because: "The source note was withdrawn.",
    });
  });
});

describe("the lease", () => {
  it("treats a missing or passed lease as recoverable", () => {
    expect(leaseExpired(null, nowIso)).toBe(true);
    expect(leaseExpired("2026-09-16T09:00:00.000Z", nowIso)).toBe(true);
    expect(leaseExpired("2026-09-16T10:05:00.000Z", nowIso)).toBe(false);
  });

  it("is bounded, not open ended", () => {
    expect(leaseUntil(nowIso, 60_000)).toBe("2026-09-16T10:01:00.000Z");
  });
});
