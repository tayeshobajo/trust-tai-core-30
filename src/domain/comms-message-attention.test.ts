import { describe, expect, it } from "vitest";
import { withMessageAttention } from "./comms-message-attention";
import { conversationSearch } from "./comms-navigation";
import type { ConversationHealth } from "./comms-health";
import type { StoredMailboxMessage } from "./comms-integrations";
const base: ConversationHealth = {
  relationshipId: "r",
  status: "healthy",
  score: 90,
  waitingOn: "waiting_on_them",
  responseCadence: "unknown",
  nextMoveStatus: "none",
  momentum: "stable",
  reasons: [],
  computedAt: "2026-11-04",
};
const msg = (
  thread: string,
  direction: "inbound" | "outbound",
  day: number,
  mailbox = "a",
): StoredMailboxMessage => ({
  id: `${thread}-${direction}-${day}-${mailbox}`,
  organizationId: "org",
  relationshipId: "r",
  providerThreadId: thread,
  direction,
  occurredAt: `2026-11-0${day}T00:00:00Z`,
  mailbox,
});
describe("stored message attention", () => {
  it("keeps inbound on one thread despite newer outbound on another", () => {
    const result = withMessageAttention(base, [msg("a", "inbound", 1), msg("b", "outbound", 3)]);
    expect(result.waitingOn).toBe("needs_us");
    expect(result.lastActivityAt).toContain("11-03");
  });
  it("keeps mailboxes distinct", () =>
    expect(
      withMessageAttention(base, [msg("a", "inbound", 1), msg("a", "outbound", 3, "b")]).waitingOn,
    ).toBe("needs_us"));
  it("recognizes a later reply in the same thread without clearing manual needs", () => {
    const messages = [msg("a", "inbound", 1), msg("a", "outbound", 3)];
    expect(withMessageAttention(base, messages).waitingOn).toBe("waiting_on_them");
    expect(
      withMessageAttention({ ...base, waitingOn: "needs_us", status: "at_risk" }, messages).status,
    ).toBe("at_risk");
  });
  it("preserves inbound on equal timestamps in either order", () => {
    const messages = [msg("a", "inbound", 1), msg("a", "outbound", 1)];
    expect(withMessageAttention(base, messages).waitingOn).toBe("needs_us");
    expect(withMessageAttention(base, messages.reverse()).waitingOn).toBe("needs_us");
  });
  it("ignores other relationships and invalid dates, keeps newer manual activity", () => {
    const result = withMessageAttention({ ...base, lastActivityAt: "2026-11-04T00:00:00Z" }, [
      { ...msg("a", "inbound", 1), relationshipId: "other" },
      { ...msg("a", "inbound", 1), occurredAt: "invalid" },
      msg("a", "outbound", 2),
    ]);
    expect(result.lastActivityAt).toContain("11-04");
    expect(result.waitingOn).toBe("waiting_on_them");
  });
  it("keeps exact legacy record targets and discards invalid search values", () => {
    expect(
      conversationSearch({ relationship: "r", thread: "t", message: "m", junk: true }),
    ).toEqual({ relationship: "r", thread: "t", message: "m" });
    expect(conversationSearch({ relationship: 12, thread: "", message: [] })).toEqual({});
  });
});
