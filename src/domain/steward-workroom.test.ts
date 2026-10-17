import { describe, expect, it } from "vitest";

import type { Commitment } from "./steward";
import { buildWorkroom, receiptKey, toRow, type WorkroomConversationInput } from "./steward-workroom";

const convo = (over: Partial<WorkroomConversationInput> = {}): WorkroomConversationInput => ({
  id: "c1",
  title: "Call",
  occurredAt: "2026-10-17T10:00:00Z",
  provider: "fathom",
  sourceUrl: "",
  participantCount: 2,
  segmentCount: 10,
  lastSegmentAt: "00:29:30",
  ...over,
});
const commit = (over: Partial<Commitment> = {}): Commitment => ({
  id: Math.random().toString(),
  organizationId: "o",
  conversationId: "c1",
  ownerName: "Ana",
  what: "Do it",
  status: "kept",
  sourceKey: "k",
  evidence: [],
  createdAt: "",
  updatedAt: "",
  ...over,
});

describe("steward workroom", () => {
  it("never scores when recording length is unknown, even if all verified", () => {
    const a = commit();
    const b = commit();
    const receipts = new Set([receiptKey(a.id), receiptKey(b.id)]);
    const [m] = buildWorkroom([convo()], [a, b], receipts);
    expect(m!.coverage).toBe("unknown");
    expect(m!.score).toBeNull();
    expect(m!.done).toBe(2);
  });

  it("gives 100 only when coverage is complete and every promise is verified", () => {
    const full = convo({ recordingSeconds: 1800 });
    const a = commit();
    const b = commit();
    const both = new Set([receiptKey(a.id), receiptKey(b.id)]);
    expect(buildWorkroom([full], [a, b], both)[0]!.score).toBe(100);
    expect(buildWorkroom([full], [a, b, commit({ status: "open" })], both)[0]!.score).toBe(67);
  });

  it("kept without a completion receipt is not verified and never counts", () => {
    const full = convo({ recordingSeconds: 1800 });
    const a = commit();
    const b = commit();
    /* No receipts at all: both are kept by status but unverified. */
    const [m] = buildWorkroom([full], [a, b], new Set());
    expect(m!.done).toBe(0);
    expect(m!.needsVerification).toBe(2);
    expect(m!.score).toBe(0);
    expect(m!.remark).toContain("without a completion record");
  });

  it("released promises leave the denominator", () => {
    const a = commit();
    const [m] = buildWorkroom(
      [convo({ recordingSeconds: 1800 })],
      [a, commit({ status: "released" })],
      new Set([receiptKey(a.id)]),
    );
    expect(m!.agreed).toBe(1);
  });

  it("owner is verified only when linked to a user; spoken dates are not exact", () => {
    const row = toRow(commit({ dueText: "next week" }));
    expect(row.owner.verified).toBe(false);
    expect(row.due.exact).toBe(false);
    expect(toRow(commit({ ownerUserId: "u" })).owner.verified).toBe(true);
  });
});
