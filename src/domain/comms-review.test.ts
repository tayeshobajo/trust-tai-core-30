/**
 * The review record's three laws: version binding, context fingerprints, and
 * approval as a role rather than mere membership.
 */

import { describe, expect, it } from "vitest";

import {
  canApproveReview,
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
    });
    expect(reading.freshness).toBe("none");
    expect(reading.sendable).toBe(false);
  });

  it("is fresh only for the exact version and context it covers", () => {
    const reading = readApproval({
      approvals: [approval()],
      currentVersionId: "v1",
      currentFingerprint: contextFingerprint(base),
    });
    expect(reading.freshness).toBe("fresh");
    expect(reading.sendable).toBe(true);
  });

  it("goes stale when the draft is edited", () => {
    const reading = readApproval({
      approvals: [approval()],
      currentVersionId: "v2",
      currentFingerprint: contextFingerprint({ ...base, versionId: "v2" }),
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
