import { describe, expect, it } from "vitest";

import { conversationTimeline, eventSide } from "@/data/comms-timeline";
import type { CommsDraft, Touch } from "@/domain/comms";
import type { StoredMailboxMessage } from "@/domain/comms-integrations";

const TOUCH: Touch = {
  id: "touch-1",
  organizationId: "org-1",
  relationshipId: "rel-1",
  channel: "note",
  direction: "outbound",
  occurredAt: "2026-08-20T09:00:00.000Z",
  summary: "Met at the summit",
};

const DRAFT: CommsDraft = {
  id: "draft-1",
  organizationId: "org-1",
  relationshipId: "rel-1",
  intent: "Following up",
  register: "warm_intro",
  body: "Hi Maya, good to meet at the summit.",
  voiceVersion: 1,
  reviewState: "sent",
  rationale: {},
  evidence: [],
  createdAt: "2026-08-20T10:00:00.000Z",
};

function mail(partial: Partial<StoredMailboxMessage>): StoredMailboxMessage {
  return {
    id: "mail-1",
    organizationId: "org-1",
    relationshipId: "rel-1",
    direction: "inbound",
    occurredAt: "2026-08-20T11:00:00.000Z",
    ...partial,
  };
}

describe("conversationTimeline with synced mail", () => {
  it("folds synced messages into the same chronological thread as touches and drafts", () => {
    const events = conversationTimeline(
      [TOUCH],
      [DRAFT],
      [mail({ subject: "About Thursday" }), mail({ id: "mail-2", direction: "outbound", occurredAt: "2026-08-20T12:00:00.000Z", subject: "Re: About Thursday" })],
    );
    expect(events.map((event) => event.id)).toEqual([
      "touch:touch-1",
      "draft:draft-1",
      "mail:mail-1",
      "mail:mail-2",
    ]);
  });

  it("places inbound mail on their side and outbound on ours", () => {
    const events = conversationTimeline([], [], [
      mail({ direction: "inbound" }),
      mail({ id: "mail-2", direction: "outbound" }),
    ]);
    expect(eventSide(events[0]!.kind)).toBe("them");
    expect(eventSide(events[1]!.kind)).toBe("us");
  });

  it("labels synced mail with its source, never as a person's own words", () => {
    const [event] = conversationTimeline([], [], [mail({ subject: "Hello" })]);
    expect(event?.source).toBe("Synced from Gmail · read-only");
    expect(event?.touchId).toBeUndefined();
  });

  it("keeps manual touches untouched and editable", () => {
    const [event] = conversationTimeline([TOUCH], [], []);
    expect(event?.touchId).toBe("touch-1");
    expect(event?.kind).toBe("note");
  });

  it("shows a sent draft as a claim until the mailbox proves it", () => {
    const [event] = conversationTimeline([], [DRAFT], []);
    expect(event?.source).toBe("Sent via Gmail — not yet seen in the mailbox");
    expect(event?.meta).toBe("sent");
  });

  it("upgrades a sent draft once the mailbox has verified it", () => {
    const verified: CommsDraft = {
      ...DRAFT,
      rationale: {
        verification: {
          state: "mailbox_verified",
          provider_message_id: "msg-9",
          verified_at: "2026-08-20T13:00:00.000Z",
          matched_by: ["recipient", "subject"],
        },
      },
    };
    const [event] = conversationTimeline([], [verified], []);
    expect(event?.source).toBe("Sent — seen in the mailbox");
    expect(event?.meta).toBe("mailbox_verified");
  });
});
