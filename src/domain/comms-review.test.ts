/**
 * The review record's three laws: version binding, context fingerprints, and
 * approval as a role rather than mere membership.
 */

import { describe, expect, it } from "vitest";

import {
  approvalReadiness,
  canApproveReview,
  reviewRunIsCurrent,
  contextFingerprint,
  nextVersionNumber,
  readApproval,
  runAppliesToCurrentVersion,
  type ReviewApproval,
  type ReviewContext,
} from "./comms-review";

const base: ReviewContext = {
  versionId: "v1",
  subject: "Re: Migration",
  body: "The migration finishes on 4 October.",
  recipientEmail: "Megan@Northlight.example",
  recipientName: "Megan Walls",
  goal: "Give her the date she asked for.",
  sourceChecksums: ["aaa", "bbb"],
  senderName: "Sam Ellis",
};

function approval(over: Partial<ReviewApproval> = {}): ReviewApproval {
  return {
    id: "ap-1",
    sessionId: "s-1",
    versionId: "v1",
    runId: "r-1",
    contextFingerprint: contextFingerprint(base),
    contextRevision: 3,
    approvedBy: "user-owner",
    approvedAt: "2026-09-14T10:00:00.000Z",
    approverRole: "owner",
    reason: "Reads true.",
    ...over,
  };
}

describe("approval authority", () => {
  it("is an owner or admin decision, not a membership one", () => {
    expect(canApproveReview("owner")).toBe(true);
    expect(canApproveReview("admin")).toBe(true);
    expect(canApproveReview("team_member")).toBe(false);
    expect(canApproveReview("project_lead")).toBe(false);
    expect(canApproveReview(null)).toBe(false);
    expect(canApproveReview("something invented")).toBe(false);
  });
});

describe("context fingerprint", () => {
  it("is stable for the same context and ignores source ordering", () => {
    expect(contextFingerprint(base)).toBe(contextFingerprint({ ...base }));
    expect(contextFingerprint({ ...base, sourceChecksums: ["bbb", "aaa"] })).toBe(
      contextFingerprint(base),
    );
  });

  it("moves when anything a person approved over moves", () => {
    const original = contextFingerprint(base);
    expect(contextFingerprint({ ...base, body: "Different words." })).not.toBe(original);
    expect(contextFingerprint({ ...base, recipientEmail: "other@example.com" })).not.toBe(original);
    expect(contextFingerprint({ ...base, goal: "Sell something." })).not.toBe(original);
    expect(contextFingerprint({ ...base, senderName: "Tai" })).not.toBe(original);
    expect(contextFingerprint({ ...base, sourceChecksums: ["aaa"] })).not.toBe(original);
  });

  it("does not move on recipient email casing alone", () => {
    expect(contextFingerprint({ ...base, recipientEmail: "megan@northlight.example" })).toBe(
      contextFingerprint(base),
    );
  });
});

describe("reading an approval", () => {
  it("says not approved when there is none", () => {
    const reading = readApproval({
      approvals: [],
      currentVersionId: "v1",
      currentFingerprint: contextFingerprint(base),
      currentRevision: 3,
    });
    expect(reading.freshness).toBe("none");
    expect(reading.sendable).toBe(false);
  });

  it("is fresh only for the exact version and context it covers", () => {
    const reading = readApproval({
      approvals: [approval()],
      currentVersionId: "v1",
      currentFingerprint: contextFingerprint(base),
      currentRevision: 3,
    });
    expect(reading.freshness).toBe("fresh");
    expect(reading.sendable).toBe(true);
  });

  it("goes stale when the draft is edited", () => {
    const reading = readApproval({
      approvals: [approval()],
      currentVersionId: "v2",
      currentFingerprint: contextFingerprint({ ...base, versionId: "v2" }),
      currentRevision: 3,
    });
    expect(reading.freshness).toBe("stale_version");
    expect(reading.sendable).toBe(false);
    expect(reading.approval?.id).toBe("ap-1");
  });

  it("goes stale when the surrounding context changes under it", () => {
    const reading = readApproval({
      approvals: [approval()],
      currentVersionId: "v1",
      currentFingerprint: contextFingerprint({ ...base, recipientEmail: "someone@else.example" }),
      currentRevision: 3,
    });
    expect(reading.freshness).toBe("stale_context");
    expect(reading.sendable).toBe(false);
  });

  it("reads the most recent approval, not the first one found", () => {
    const older = approval({ id: "ap-0", approvedAt: "2026-09-13T09:00:00.000Z", versionId: "v0" });
    const reading = readApproval({
      approvals: [older, approval()],
      currentVersionId: "v1",
      currentFingerprint: contextFingerprint(base),
      currentRevision: 3,
    });
    expect(reading.approval?.id).toBe("ap-1");
    expect(reading.freshness).toBe("fresh");
  });
});

describe("version binding", () => {
  it("numbers versions without reuse", () => {
    expect(nextVersionNumber([])).toBe(1);
    expect(nextVersionNumber([{ version: 1 }, { version: 3 }])).toBe(4);
  });

  it("refuses to apply a run that judged older words", () => {
    expect(runAppliesToCurrentVersion({ versionId: "v1" }, "v1")).toBe(true);
    expect(runAppliesToCurrentVersion({ versionId: "v1" }, "v2")).toBe(false);
    expect(runAppliesToCurrentVersion(null, "v1")).toBe(false);
  });
});

/* ------------------------------------------------------- run currency */

const RUN = {
  versionId: "v1",
  contextFingerprint: "fp-1",
  contextRevision: 3,
  status: "complete" as const,
};

describe("a run only speaks for the work in front of you", () => {
  const at = { currentVersionId: "v1", currentFingerprint: "fp-1", currentRevision: 3 };

  it("counts when the version, the fingerprint and the revision all match", () => {
    expect(reviewRunIsCurrent({ run: RUN, ...at })).toBe(true);
  });

  it("does not count when the words moved", () => {
    expect(reviewRunIsCurrent({ run: RUN, ...at, currentVersionId: "v2" })).toBe(false);
  });

  it("does not count when the context moved under the same version", () => {
    expect(reviewRunIsCurrent({ run: RUN, ...at, currentFingerprint: "fp-2" })).toBe(false);
    expect(reviewRunIsCurrent({ run: RUN, ...at, currentRevision: 4 })).toBe(false);
  });

  it("does not count when the run never finished", () => {
    expect(reviewRunIsCurrent({ run: { ...RUN, status: "running" }, ...at })).toBe(false);
    expect(reviewRunIsCurrent({ run: { ...RUN, status: "failed" }, ...at })).toBe(false);
    expect(reviewRunIsCurrent({ run: null, ...at })).toBe(false);
  });
});

/* ---------------------------------------------------------- readiness */

const READY = {
  run: RUN,
  currentVersionId: "v1",
  currentFingerprint: "fp-1",
  currentRevision: 3,
  findings: [] as {
    severity: "must_fix" | "consider" | "note";
    state: "open" | "accepted" | "kept" | "edited";
    versionId: string;
  }[],
  sources: [{ status: "parsed" }],
  coverage: { complete: true, outstanding: 0, uncertain: 0 },
};

describe("what has to be true before a person may approve", () => {
  it("is ready when everything was read, answered and judged on these words", () => {
    const readiness = approvalReadiness(READY);
    expect(readiness.ready).toBe(true);
    expect(readiness.blockers).toEqual([]);
  });

  it("is never ready without a review; a missing review is not optional", () => {
    const readiness = approvalReadiness({ ...READY, run: null });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers[0]).toMatch(/not been reviewed/i);
  });

  it("is not ready on a failed or still-running review", () => {
    expect(approvalReadiness({ ...READY, run: { ...RUN, status: "failed" } }).ready).toBe(false);
    expect(approvalReadiness({ ...READY, run: { ...RUN, status: "running" } }).ready).toBe(false);
  });

  it("is not ready when the review judged older words or an older context", () => {
    expect(approvalReadiness({ ...READY, currentVersionId: "v2" }).ready).toBe(false);
    expect(approvalReadiness({ ...READY, currentRevision: 4 }).ready).toBe(false);
  });

  it("is not ready while any source went unread", () => {
    const readiness = approvalReadiness({
      ...READY,
      sources: [{ status: "parsed" }, { status: "unsupported" }],
    });
    expect(readiness.ready).toBe(false);
    expect(readiness.blockers.join(" ")).toMatch(/could not be read/i);
  });

  it("is not ready while anything asked is unanswered or unverifiable", () => {
    const outstanding = approvalReadiness({
      ...READY,
      coverage: { complete: false, outstanding: 2, uncertain: 0 },
    });
    expect(outstanding.blockers.join(" ")).toMatch(/2 unanswered/);

    const uncertain = approvalReadiness({
      ...READY,
      coverage: { complete: false, outstanding: 0, uncertain: 1 },
    });
    expect(uncertain.ready).toBe(false);
    expect(uncertain.blockers.join(" ")).toMatch(/not verifiable/);
  });

  it("does not let any click clear a must fix", () => {
    for (const state of ["open", "kept", "accepted", "edited"] as const) {
      const readiness = approvalReadiness({
        ...READY,
        findings: [{ severity: "must_fix", state, versionId: "v1" }],
      });
      expect(readiness.ready).toBe(false);
      expect(readiness.blockers.join(" ")).toMatch(/does not clear/i);
    }
  });

  it("lets a lesser finding be kept without blocking approval", () => {
    const readiness = approvalReadiness({
      ...READY,
      findings: [
        { severity: "consider", state: "kept", versionId: "v1" },
        { severity: "note", state: "open", versionId: "v1" },
      ],
    });
    expect(readiness.ready).toBe(true);
  });

  it("names every blocker at once rather than one at a time", () => {
    const readiness = approvalReadiness({
      ...READY,
      run: null,
      sources: [{ status: "unreadable" }],
      coverage: { complete: false, outstanding: 1, uncertain: 0 },
      findings: [{ severity: "must_fix", state: "open", versionId: "v1" }],
    });
    expect(readiness.blockers).toHaveLength(4);
  });
});
