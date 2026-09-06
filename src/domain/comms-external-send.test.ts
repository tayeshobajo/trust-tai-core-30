/**
 * Reconciling a reply sent from Gmail. The law under test: provider evidence
 * only, ambiguity refuses, repeats change nothing, and a reconciled draft is
 * verified without ever becoming human accepted.
 */

import { describe, expect, it } from "vitest";
import {
  matchExternalSend,
  planExternalReconciliations,
  readExternalSend,
  writeExternalSend,
  type ObservedOutboundLike,
  type OpenDraftLike,
} from "./comms-external-send";
import { decideSendClaim } from "./comms-send";

const DRAFT: OpenDraftLike = {
  id: "d1",
  subject: "Re: Input Items",
  createdAt: "2026-01-10T09:00:00.000Z",
  providerThreadId: "thread-a",
  recipientEmail: "lauryn@example.com",
};

function message(over: Partial<ObservedOutboundLike> = {}): ObservedOutboundLike {
  return {
    providerMessageId: "m1",
    providerThreadId: "thread-a",
    direction: "outbound",
    occurredAt: "2026-01-10T11:00:00.000Z",
    subject: "Re: Input Items",
    toEmails: ["lauryn@example.com"],
    ccEmails: [],
    ...over,
  };
}

describe("matchExternalSend", () => {
  it("matches on the provider thread plus the recipient", () => {
    expect(matchExternalSend(DRAFT, message())).toEqual(["thread", "recipient"]);
  });

  it("refuses a different thread even when the subject agrees", () => {
    expect(matchExternalSend(DRAFT, message({ providerThreadId: "thread-b" }))).toBeNull();
  });

  it("refuses when the message went to somebody else", () => {
    expect(matchExternalSend(DRAFT, message({ toEmails: ["other@example.com"] }))).toBeNull();
  });

  it("refuses a message that predates the draft", () => {
    expect(matchExternalSend(DRAFT, message({ occurredAt: "2026-01-09T09:00:00.000Z" }))).toBeNull();
  });

  it("refuses inbound mail", () => {
    expect(matchExternalSend(DRAFT, message({ direction: "inbound" }))).toBeNull();
  });

  it("falls back to subject plus recipient only when the draft has no thread", () => {
    const { providerThreadId: _drop, ...threadless } = DRAFT;
    expect(matchExternalSend(threadless, message({ providerThreadId: "thread-z" }))).toEqual([
      "subject",
      "recipient",
    ]);
  });

  it("refuses when the draft has no recipient at all", () => {
    const { recipientEmail: _drop, ...anonymous } = DRAFT;
    expect(matchExternalSend(anonymous, message())).toBeNull();
  });
});

describe("planExternalReconciliations", () => {
  it("reconciles one draft against one message", () => {
    const plan = planExternalReconciliations([DRAFT], [message()]);
    expect(plan).toEqual([
      {
        draftId: "d1",
        providerMessageId: "m1",
        providerThreadId: "thread-a",
        sentAt: "2026-01-10T11:00:00.000Z",
        matchedBy: ["thread", "recipient"],
      },
    ]);
  });

  it("refuses when one draft could be settled by two messages", () => {
    const plan = planExternalReconciliations(
      [DRAFT],
      [message(), message({ providerMessageId: "m2", occurredAt: "2026-01-10T12:00:00.000Z" })],
    );
    expect(plan).toEqual([]);
  });

  it("refuses when one message could settle two drafts", () => {
    const plan = planExternalReconciliations([DRAFT, { ...DRAFT, id: "d2" }], [message()]);
    expect(plan).toEqual([]);
  });

  it("leaves an unmatched draft alone", () => {
    const other: OpenDraftLike = { ...DRAFT, id: "d3", providerThreadId: "thread-q" };
    const plan = planExternalReconciliations([DRAFT, other], [message()]);
    expect(plan.map((entry) => entry.draftId)).toEqual(["d1"]);
  });
});

describe("the stamp", () => {
  it("round-trips and is idempotent to re-read", () => {
    const rationale = writeExternalSend(
      { provider_thread_id: "thread-a" },
      {
        state: "sent_externally",
        providerMessageId: "m1",
        providerThreadId: "thread-a",
        sentAt: "2026-01-10T11:00:00.000Z",
        reconciledAt: "2026-01-10T11:05:00.000Z",
        matchedBy: ["thread", "recipient"],
      },
    );
    expect(rationale["provider_thread_id"]).toBe("thread-a");
    const read = readExternalSend(rationale);
    expect(read?.providerMessageId).toBe("m1");
    expect(read?.state).toBe("sent_externally");
    expect(readExternalSend(writeExternalSend(rationale, read!))).toEqual(read);
  });

  it("is never read as a human acceptance, and never as an approval", () => {
    const rationale = writeExternalSend(null, {
      state: "sent_externally",
      providerMessageId: "m1",
      sentAt: "2026-01-10T11:00:00.000Z",
      reconciledAt: "2026-01-10T11:05:00.000Z",
      matchedBy: ["thread", "recipient"],
    });
    expect(rationale["approval"]).toBeUndefined();
    expect(rationale["send"]).toBeUndefined();
  });

  it("refuses malformed stamps", () => {
    expect(readExternalSend({ external_send: { state: "sent_externally" } })).toBeNull();
    expect(readExternalSend({ external_send: "yes" })).toBeNull();
    expect(readExternalSend(null)).toBeNull();
  });
});

describe("send law", () => {
  it("will not send a draft the person already answered from Gmail", () => {
    const rationale = writeExternalSend(null, {
      state: "sent_externally",
      providerMessageId: "m1",
      sentAt: "2026-01-10T11:00:00.000Z",
      reconciledAt: "2026-01-10T11:05:00.000Z",
      matchedBy: ["thread", "recipient"],
    });
    const decision = decideSendClaim({ reviewState: "approved", rationale });
    expect(decision.kind).toBe("not_sendable");
  });

  it("leaves an ordinary approved draft sendable by a person", () => {
    const decision = decideSendClaim({
      reviewState: "approved",
      rationale: {
        approval: {
          state: "approved",
          by: { id: "u1", label: "Tai" },
          at: "2026-01-10T09:30:00.000Z",
        },
      },
    });
    expect(decision.kind).toBe("claim");
  });
});
