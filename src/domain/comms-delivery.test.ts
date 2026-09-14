import { describe, expect, it } from "vitest";

import {
  decideSend,
  deliveryKey,
  describeDelivery,
  outboundFingerprint,
  type OutboundPayload,
  type SendDecisionInput,
} from "./comms-delivery";

const payload: OutboundPayload = {
  channel: "email_gmail",
  subject: "Re: dates",
  body: "The migration finishes on 4 October.",
  recipient: "Megan@Northlight.example",
  senderIdentity: "sam@trusttai.example",
  attachments: [
    { name: "plan.pdf", bytes: 1200 },
    { name: "terms.pdf", bytes: 900 },
  ],
};

const FP = outboundFingerprint(payload);

function input(over: Partial<SendDecisionInput> = {}): SendDecisionInput {
  return {
    missingCapability: [],
    approval: {
      id: "approval-1",
      runId: "run-1",
      versionId: "version-1",
      approvedPayloadFingerprint: FP,
      contextRevision: 4,
      contextFingerprint: "ctx-1",
    },
    run: { id: "run-1", status: "complete", contextRevision: 4 },
    blockers: [],
    currentContextRevision: 4,
    currentContextFingerprint: "ctx-1",
    payloadFingerprint: FP,
    callerMaySend: true,
    ...over,
  };
}

describe("outboundFingerprint", () => {
  it("ignores the order files were attached in, and the case of an address", () => {
    expect(
      outboundFingerprint({
        ...payload,
        recipient: "megan@northlight.example",
        attachments: [...payload.attachments].reverse(),
      }),
    ).toBe(FP);
  });

  it.each([
    ["the words", { body: "The migration finishes on 5 October." }],
    ["the subject", { subject: "Re: the date" }],
    ["the recipient", { recipient: "someone@else.example" }],
    ["the sending identity", { senderIdentity: "tai@trusttai.example" }],
    ["the channel", { channel: "email_resend" as const }],
    ["an attachment", { attachments: [{ name: "plan.pdf", bytes: 1201 }] }],
  ])("is a different message when %s changes", (_label, over) => {
    expect(outboundFingerprint({ ...payload, ...over })).not.toBe(FP);
  });
});

describe("decideSend", () => {
  it("lets an approved, current, unchanged message go", () => {
    const decision = decideSend(input());
    expect(decision.allowed).toBe(true);
  });

  it.each([
    [
      "the database cannot tie a draft to its review",
      { missingCapability: ["no draft_id"] },
      "capability_missing",
    ],
    ["nobody approved it", { approval: null }, "no_review"],
    [
      "the review never finished",
      { run: { id: "run-1", status: "failed", contextRevision: 4 } },
      "review_incomplete",
    ],
    ["the approved run is gone", { run: null }, "review_incomplete"],
    [
      "the message was edited after approval",
      { payloadFingerprint: "different" },
      "payload_changed",
    ],
    ["the situation moved", { currentContextFingerprint: "ctx-2" }, "stale_context"],
    ["the conversation was revised", { currentContextRevision: 5 }, "stale_context"],
    ["the review still holds something", { blockers: ["A price is wrong."] }, "blocked"],
    ["the person may not send", { callerMaySend: false }, "not_authorised"],
  ])("refuses when %s", (_label, over, code) => {
    const decision = decideSend(input(over as Partial<SendDecisionInput>));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.code).toBe(code);
    expect(decision.message).toMatch(/nothing was sent|Nothing was sent/);
    expect(decision.blockers.length).toBeGreaterThan(0);
  });

  it("names the pending database change rather than blaming the person", () => {
    const decision = decideSend(input({ missingCapability: ["no draft_id"] }));
    expect(decision.allowed).toBe(false);
    if (decision.allowed) return;
    expect(decision.message).toMatch(/20260914170000_comms_review_delivery\.sql/);
  });
});

describe("what we say afterwards", () => {
  it("never calls a lost answer a failure", () => {
    expect(describeDelivery("unknown", "email_resend")).toMatch(/cannot be confirmed/i);
    expect(describeDelivery("unknown", "email_resend")).toMatch(/will not be retried/i);
  });

  it("calls a LinkedIn record a person's word, not a delivery", () => {
    expect(describeDelivery("sent", "linkedin_manual")).toMatch(/your word/i);
    expect(describeDelivery("sent", "linkedin_manual")).not.toMatch(/provider confirmed/i);
  });

  it("keys an attempt to the exact payload, so a retry is the same attempt", () => {
    expect(deliveryKey("draft-1", FP)).toBe(deliveryKey("draft-1", FP));
    expect(deliveryKey("draft-1", FP)).not.toBe(deliveryKey("draft-1", "other"));
  });
});
