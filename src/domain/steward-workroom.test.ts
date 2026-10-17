import { describe, expect, it } from "vitest";

import type { Commitment } from "./steward";
import { buildWorkroom, toRow, type WorkroomConversationInput } from "./steward-workroom";

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
  it("never scores when recording length is unknown, even if all kept", () => {
    const [m] = buildWorkroom([convo()], [commit(), commit()]);
    expect(m!.coverage).toBe("unknown");
    expect(m!.score).toBeNull();
    expect(m!.done).toBe(2);
  });

  it("gives 100 only when coverage is complete and every promise is kept", () => {
    const full = convo({ recordingSeconds: 1800 });
    expect(buildWorkroom([full], [commit(), commit()])[0]!.score).toBe(100);
    expect(buildWorkroom([full], [commit(), commit({ status: "open" })])[0]!.score).toBe(50);
  });

  it("released promises leave the denominator", () => {
    const [m] = buildWorkroom(
      [convo({ recordingSeconds: 1800 })],
      [commit(), commit({ status: "released" })],
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
