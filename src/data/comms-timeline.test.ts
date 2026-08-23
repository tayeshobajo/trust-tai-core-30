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

/* ======================================================================
 * Message fidelity: full body over snippet on the timeline
 * ==================================================================== */

describe("conversationTimeline email body fidelity", () => {
  it("shows the full body, keeps html and inline resources, and flags blocked images", () => {
    const events = conversationTimeline({
      touches: [],
      messages: [
        {
          id: "msg-1",
          organizationId: "org-1",
          relationshipId: "rel-1",
          providerMessageId: "pm-1",
          direction: "inbound",
          fromEmail: "riley@example.com",
          subject: "Proposal",
          snippet: "A short preview…",
          bodyText: "The full body text, well beyond the snippet.",
          bodyHtml: "<p>The full <b>body</b> text.</p>",
          blockedRemoteImages: 2,
          occurredAt: "2026-08-22T10:00:00Z",
          attachments: [
            { filename: "brief.pdf", mimeType: "application/pdf", size: 100, attachmentId: "a1" },
            {
              filename: "logo.png",
              mimeType: "image/png",
              size: 50,
              attachmentId: "a2",
              contentId: "logo@acme",
              inline: true,
            },
          ],
        },
      ],
      emails: ["riley@example.com"],
    });
    expect(events).toHaveLength(1);
    const event = events[0]!;
    expect(event.kind).toBe("they_emailed");
    expect(event.body).toBe("The full body text, well beyond the snippet.");
    expect(event.htmlBody).toBe("<p>The full <b>body</b> text.</p>");
    expect(event.blockedRemoteImages).toBe(2);
    expect(event.attachments).toHaveLength(2);
  });

  it("falls back to the snippet when no body was captured", () => {
    const events = conversationTimeline({
      touches: [],
      messages: [
        {
          id: "msg-2",
          organizationId: "org-1",
          relationshipId: "rel-1",
          direction: "outbound",
          snippet: "Metadata-era preview",
          occurredAt: "2026-08-21T10:00:00Z",
        },
      ],
      emails: ["riley@example.com"],
    });
    expect(events[0]!.body).toBe("Metadata-era preview");
    expect(events[0]!.htmlBody).toBeUndefined();
  });
});
