import { describe, expect, it } from "vitest";

import type { Commitment } from "./steward";
import {
  buildWorkroom,
  receiptKey,
  toRow,
  validReceipt,
  type CompletionReceipt,
  type WorkroomConversationInput,
} from "./steward-workroom";

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
const receipt = (id: string, over: Partial<CompletionReceipt> = {}): CompletionReceipt => ({
  taskKey: receiptKey(id),
  completedAt: "2026-10-17T12:00:00Z",
  completionNote: "Done and shared with the team.",
  completedBy: "Ana",
  ...over,
});
const receipts = (...rs: CompletionReceipt[]) => new Map(rs.map((r) => [r.taskKey, r]));

describe("coverage", () => {
  it("is unknown unless a trustworthy source contract confirms it", () => {
    expect(buildWorkroom([convo()], [], receipts())[0]!.coverage).toBe("unknown");
    /* A non-empty transcript with a late last segment is NOT proof. */
    expect(
      buildWorkroom([convo({ segmentCount: 500, lastSegmentAt: "01:06:45" })], [], receipts())[0]!
        .coverage,
    ).toBe("unknown");
    expect(buildWorkroom([convo({ coverageConfirmed: true })], [], receipts())[0]!.coverage).toBe(
      "complete",
    );
  });
});

describe("receipts", () => {
  it("requires a valid timestamp and a substantive note", () => {
    expect(validReceipt(receipt("a"))).toBe(true);
    expect(validReceipt(receipt("a", { completionNote: "done" }))).toBe(false);
    expect(validReceipt(receipt("a", { completionNote: "          " }))).toBe(false);
    expect(validReceipt(receipt("a", { completedAt: "not a date" }))).toBe(false);
    expect(validReceipt(receipt("a", { completedAt: undefined }))).toBe(false);
    expect(validReceipt(undefined)).toBe(false);
  });

  it("kept without a valid receipt is not verified and never counts", () => {
    const a = commit();
    const b = commit();
    const [m] = buildWorkroom(
      [convo({ coverageConfirmed: true })],
      [a, b],
      receipts(receipt(a.id, { completionNote: "ok" })),
    );
    expect(m!.done).toBe(0);
    expect(m!.needsVerification).toBe(2);
    expect(m!.remark).toContain("without a completion record");
  });

  it("exposes the actual receipt on a verified row", () => {
    const a = commit();
    const row = toRow(a, receipts(receipt(a.id)));
    expect(row.verified).toBe(true);
    expect(row.receipt?.completedBy).toBe("Ana");
  });
});

describe("score", () => {
  it("measures verified agreed work against the real denominator", () => {
    const a = commit();
    const b = commit();
    const [m] = buildWorkroom(
      [convo()],
      [a, b],
      receipts(receipt(a.id)),
    );
    expect(m!.score).toBe(50);
  });

  it("never reaches 100 while coverage is unconfirmed, even if all verified", () => {
    const a = commit();
    const [m] = buildWorkroom([convo()], [a], receipts(receipt(a.id)));
    expect(m!.score).toBe(99);
  });

  it("never reaches 100 while unreviewed proposals remain", () => {
    const a = commit();
    const [m] = buildWorkroom(
      [convo({ coverageConfirmed: true })],
      [a],
      receipts(receipt(a.id)),
      new Map([["c1", 2]]),
    );
    expect(m!.score).toBe(99);
  });

  it("gives 100 only when all verified, coverage confirmed and no proposals", () => {
    const a = commit();
    const b = commit();
    const [m] = buildWorkroom(
      [convo({ coverageConfirmed: true })],
      [a, b],
      receipts(receipt(a.id), receipt(b.id)),
      new Map([["c1", 0]]),
    );
    expect(m!.score).toBe(100);
  });

  it("released promises leave the denominator", () => {
    const a = commit();
    const [m] = buildWorkroom(
      [convo()],
      [a, commit({ status: "released" })],
      receipts(receipt(a.id)),
    );
    expect(m!.agreed).toBe(1);
  });
});

describe("rows", () => {
  it("owner is verified only when linked to a user; spoken dates are not exact", () => {
    const row = toRow(commit({ dueText: "next week" }));
    expect(row.owner.verified).toBe(false);
    expect(row.due.exact).toBe(false);
    expect(toRow(commit({ ownerUserId: "u" })).owner.verified).toBe(true);
  });
});
