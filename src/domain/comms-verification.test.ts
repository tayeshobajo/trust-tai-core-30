import { describe, expect, it } from "vitest";

import {
  bodyFingerprint,
  draftProvenanceLabel,
  matchSentDraft,
  normalizeSubject,
  planDraftVerifications,
  readDraftVerification,
  type ObservedMessageLike,
  type SentDraftLike,
} from "@/domain/comms-verification";

const DRAFT: SentDraftLike = {
  id: "draft-1",
  subject: "Following up",
  body: "Hi Maya, it was good to meet at the summit. I promised to send the one-pager.",
  markedSentAt: "2026-08-20T10:00:00.000Z",
  recipientEmail: "maya@example.com",
};

function message(partial: Partial<ObservedMessageLike>): ObservedMessageLike {
  return {
    providerMessageId: "msg-1",
    direction: "outbound",
    occurredAt: "2026-08-20T10:05:00.000Z",
    toEmails: ["maya@example.com"],
    ccEmails: [],
    ...partial,
  };
}

describe("normalizeSubject", () => {
  it("ignores reply prefixes, case and punctuation", () => {
    expect(normalizeSubject("Re: Fwd: Following Up!")).toBe(normalizeSubject("following up"));
  });
});

describe("matchSentDraft", () => {
  it("matches on subject and recipient inside the window", () => {
    expect(matchSentDraft(DRAFT, message({ subject: "Re: Following up" }))).toEqual([
      "recipient",
      "subject",
    ]);
  });

  it("matches on the opening words when subjects differ or are absent", () => {
    const noSubjectDraft: SentDraftLike = { ...DRAFT };
    delete noSubjectDraft.subject;
    const matched = matchSentDraft(
      noSubjectDraft,
      message({
        snippet: "Hi Maya, it was good to meet at the summit. I promised to send the one-pager…",
      }),
    );
    expect(matched).toContain("body");
  });

  it("refuses an inbound message", () => {
    expect(matchSentDraft(DRAFT, message({ direction: "inbound", subject: "Following up" }))).toBeNull();
  });

  it("refuses a message to a different person", () => {
    expect(
      matchSentDraft(DRAFT, message({ subject: "Following up", toEmails: ["someone@else.com"] })),
    ).toBeNull();
  });

  it("refuses a different subject when both are present", () => {
    expect(matchSentDraft(DRAFT, message({ subject: "Unrelated topic" }))).toBeNull();
  });

  it("refuses a message sent long before the draft was marked sent", () => {
    expect(
      matchSentDraft(
        DRAFT,
        message({ subject: "Following up", occurredAt: "2026-08-19T01:00:00.000Z" }),
      ),
    ).toBeNull();
  });

  it("refuses a message outside the reconciliation window", () => {
    expect(
      matchSentDraft(
        DRAFT,
        message({ subject: "Following up", occurredAt: "2026-10-01T10:00:00.000Z" }),
      ),
    ).toBeNull();
  });

  it("never matches a very short body on content alone", () => {
    const shortDraft: SentDraftLike = { ...DRAFT, body: "Thanks!" };
    delete shortDraft.subject;
    expect(bodyFingerprint(shortDraft.body).length).toBeLessThan(24);
    expect(
      matchSentDraft(shortDraft, message({ snippet: "Thanks! Talk soon." })),
    ).toBeNull();
  });
});

describe("planDraftVerifications", () => {
  it("lets one message verify only one draft, oldest claim first", () => {
    const older = DRAFT;
    const newer = { ...DRAFT, id: "draft-2", markedSentAt: "2026-08-20T11:00:00.000Z" };
    const plan = planDraftVerifications([newer, older], [message({ subject: "Following up" })]);
    expect(plan).toEqual([
      { draftId: "draft-1", providerMessageId: "msg-1", matchedBy: ["recipient", "subject"] },
    ]);
  });

  it("matches each draft to the earliest qualifying message", () => {
    const plan = planDraftVerifications(
      [DRAFT],
      [
        message({ providerMessageId: "later", subject: "Following up", occurredAt: "2026-08-20T12:00:00.000Z" }),
        message({ providerMessageId: "earlier", subject: "Following up", occurredAt: "2026-08-20T10:05:00.000Z" }),
      ],
    );
    expect(plan[0]?.providerMessageId).toBe("earlier");
  });

  it("leaves unprovable drafts alone", () => {
    expect(planDraftVerifications([DRAFT], [])).toEqual([]);
  });
});

describe("readDraftVerification", () => {
  it("reads a stamp written by the sync", () => {
    const stamp = readDraftVerification({
      violations: [],
      verification: {
        state: "mailbox_verified",
        provider_message_id: "msg-1",
        verified_at: "2026-08-21T00:00:00.000Z",
        matched_by: ["subject"],
      },
    });
    expect(stamp?.providerMessageId).toBe("msg-1");
    expect(stamp?.matchedBy).toEqual(["subject"]);
  });

  it("ignores anything that is not a real stamp", () => {
    expect(readDraftVerification(null)).toBeNull();
    expect(readDraftVerification({})).toBeNull();
    expect(readDraftVerification({ verification: { state: "guessed" } })).toBeNull();
  });
});

describe("draftProvenanceLabel", () => {
  const stamp = readDraftVerification({
    verification: { state: "mailbox_verified", provider_message_id: "m", verified_at: "x" },
  });

  it("distinguishes claim from proof", () => {
    expect(draftProvenanceLabel("sent", stamp)).toBe("Sent — seen in the mailbox");
    expect(draftProvenanceLabel("sent", null)).toBe("Marked as sent — not yet seen in the mailbox");
    expect(draftProvenanceLabel("approved", null)).toBe("Approved, waiting to be sent");
    expect(draftProvenanceLabel("draft", null)).toBe("Prepared in Comms, not sent");
  });
});
