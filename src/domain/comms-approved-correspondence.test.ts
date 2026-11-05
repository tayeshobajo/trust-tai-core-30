import { describe, expect, it } from "vitest";
import {
  distinctApprovedFacts,
  withApprovedCorrespondence,
  type ApprovedCorrespondenceFact,
} from "./comms-approved-correspondence";
import { event, org, relationship } from "./roadmap-correspondence.fixtures";
import type { ConversationHealth } from "./comms-health";
import type { StoredMailboxMessage } from "./comms-integrations";
import { conversationTimeline } from "@/data/comms-timeline";
import { withMessageAttention } from "./comms-message-attention";
const now = new Date("2026-11-05T12:00:00Z");
const base = {
  relationshipId: relationship,
  status: "quiet",
  score: 50,
  nextMoveStatus: "none",
  waitingOn: "no_next_move",
  reasons: ["No activity recorded"],
  computedAt: now.toISOString(),
} as ConversationHealth;
const fact = (patch: Partial<ApprovedCorrespondenceFact> = {}): ApprovedCorrespondenceFact => ({
  eventKey: "a".repeat(64),
  organizationId: org,
  roadmapId: event.roadmapId,
  relationshipId: relationship,
  channel: "email",
  kind: "received",
  occurredAt: "2026-10-21T10:00:00Z",
  timestampPrecision: "exact",
  sourceAccountRef: "team@example.test",
  sourceEventId: "inbound-1",
  identityKind: "provider_id",
  ...patch,
});
const message = (patch: Partial<StoredMailboxMessage> = {}): StoredMailboxMessage => ({
  id: "stored",
  organizationId: org,
  relationshipId: relationship,
  direction: "inbound",
  occurredAt: "2026-10-21T10:00:00Z",
  mailbox: "team@example.test",
  providerMessageId: "inbound-1",
  providerThreadId: "thread-1",
  ...patch,
});

describe("approved correspondence reconciliation", () => {
  it("restores Sherri-like activity with separate incoming/outgoing dates without inventing overdue or thread resolution", () => {
    const facts = [
      fact(),
      fact({
        eventKey: "b".repeat(64),
        kind: "sent",
        sourceEventId: "outbound-1",
        occurredAt: "2026-10-21T11:00:00Z",
      }),
      fact({
        eventKey: "c".repeat(64),
        kind: "sent",
        sourceEventId: "outbound-2",
        occurredAt: "2026-10-22T12:00:00Z",
      }),
    ];
    const health = withApprovedCorrespondence(base, facts, [], now);
    expect(health).toMatchObject({
      status: "needs_attention",
      lastReplyAt: "2026-10-21T10:00:00Z",
      lastOutboundAt: "2026-10-22T12:00:00Z",
      lastActivityAt: "2026-10-22T12:00:00Z",
      waitingOn: "needs_us",
      nextMoveStatus: "none",
    });
    expect(health.reasons[0]).toContain("no verified thread linkage");
    expect(conversationTimeline([], [], [], facts)).toHaveLength(3);
  });
  it("preserves Bruce-like overdue and separate stored-thread obligations", () => {
    const manual = {
      ...base,
      status: "at_risk" as const,
      nextMoveStatus: "overdue" as const,
      waitingOn: "needs_us" as const,
      reasons: ["Recorded response is overdue"],
    };
    const mail = [
      message(),
      message({
        id: "other",
        providerMessageId: "out-other",
        providerThreadId: "thread-2",
        direction: "outbound",
        occurredAt: "2026-10-30T10:00:00Z",
      }),
    ];
    const h = withApprovedCorrespondence(
      withMessageAttention(manual, mail),
      [fact({ kind: "sent", sourceEventId: "approved-out", occurredAt: "2026-11-01T10:00:00Z" })],
      mail,
      now,
    );
    expect(h.status).toBe("at_risk");
    expect(h.nextMoveStatus).toBe("overdue");
    expect(h.waitingOn).toBe("needs_us");
    expect(h.reasons.join()).toContain("Recorded response is overdue");
  });
  it("deduplicates repeated approved sources and exact matching stored messages without copying or mutating", () => {
    const f = fact(),
      m = message();
    expect(distinctApprovedFacts([f, { ...f, eventKey: "b".repeat(64) }], [])).toHaveLength(1);
    expect(distinctApprovedFacts([f], [m])).toEqual([]);
    expect(conversationTimeline([], [], [m], [f])).toHaveLength(1);
    expect(f.kind).toBe("received");
  });
  it.each([
    { sourceAccountRef: "other@example.test" },
    { identityKind: "reviewed_receipt" as const },
    { timestampPrecision: "approximate" as const },
    { kind: "sent" as const },
    { occurredAt: "2026-10-22T10:00:00Z" },
    { relationshipId: org },
  ])("does not merge ambiguous or conflicting identity %j", (patch) =>
    expect(distinctApprovedFacts([fact(patch)], [message()])).toHaveLength(1),
  );
  it("only an already stored, same-account same-thread later outbound affects the duplicate inbound's message attention", () => {
    const mail = [
      message(),
      message({
        id: "out",
        direction: "outbound",
        providerMessageId: "out",
        occurredAt: "2026-10-22T10:00:00Z",
      }),
    ];
    const h = withApprovedCorrespondence(withMessageAttention(base, mail), [fact()], mail, now);
    expect(h.waitingOn).not.toBe("needs_us");
    expect(h.nextMoveStatus).toBe("none");
  });
  it("drafts, bounces and team copies do not become actual outgoing correspondence or due dates", () => {
    for (const kind of ["draft", "bounce", "team_outbound_copy"] as const) {
      const h = withApprovedCorrespondence(base, [fact({ kind })], [], now);
      expect(h.lastActivityAt).toBeUndefined();
      expect(h.lastOutboundAt).toBeUndefined();
      expect(h.status).toBe("quiet");
    }
  });
  it("preserves approximate timestamp qualification instead of presenting an exact incoming time", () => {
    const h = withApprovedCorrespondence(
      base,
      [
        fact({
          channel: "linkedin",
          identityKind: "reviewed_receipt",
          timestampPrecision: "approximate",
        }),
      ],
      [],
      now,
    );
    expect(h.lastIncomingApproximate).toBe(true);
    expect(h.nextMoveStatus).toBe("none");
  });
  it("metadata timeline entries cannot fetch message bodies or provider attachments", () => {
    const row = conversationTimeline([], [], [], [fact()])[0]!;
    expect(row.messageId).toBeUndefined();
    expect(row.touchId).toBeUndefined();
    expect(row.body).toBeUndefined();
    expect(row.approvedRoadmapId).toBe(event.roadmapId);
  });
});
