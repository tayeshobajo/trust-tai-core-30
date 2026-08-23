import { describe, expect, it } from "vitest";

import {
  decideSendClaim,
  readDraftSend,
  sendIdempotencyKey,
  STALE_SENDING_MS,
  writeDraftSend,
  type DraftSend,
} from "./comms-send";

const SEND: DraftSend = {
  state: "sending",
  idempotencyKey: "send:d1",
  attemptedAt: "2026-08-01T10:00:00.000Z",
  threadTarget: { mode: "reply", providerThreadId: "t1" },
  attachments: [{ filename: "brief.pdf", mimeType: "application/pdf", size: 4000 }],
};

describe("sendIdempotencyKey", () => {
  it("is stable per draft — one draft, one send identity", () => {
    expect(sendIdempotencyKey("d1")).toBe("send:d1");
    expect(sendIdempotencyKey("d1")).toBe(sendIdempotencyKey("d1"));
    expect(sendIdempotencyKey("d1")).not.toBe(sendIdempotencyKey("d2"));
  });
});

describe("draftSend rationale IO", () => {
  it("round-trips the whole record, preserving the rest of the rationale", () => {
    const rationale = writeDraftSend({ violations: [] }, SEND);
    expect(rationale["violations"]).toEqual([]);
    expect(readDraftSend(rationale)).toEqual(SEND);
  });

  it("round-trips a completed send with provider ids", () => {
    const sent: DraftSend = {
      state: "sent",
      idempotencyKey: "send:d1",
      attemptedAt: "2026-08-01T10:00:00.000Z",
      sentAt: "2026-08-01T10:00:04.000Z",
      providerMessageId: "gmail-msg-1",
      providerThreadId: "gmail-thread-1",
      threadTarget: { mode: "new" },
    };
    expect(readDraftSend(writeDraftSend({}, sent))).toEqual(sent);
  });

  it("round-trips a failure with its reason and the scope it needs", () => {
    const failed: DraftSend = {
      state: "failed",
      idempotencyKey: "send:d1",
      attemptedAt: "2026-08-01T10:00:00.000Z",
      error: "Gmail refused the send (403).",
      requiredScope: "https://www.googleapis.com/auth/gmail.send",
    };
    expect(readDraftSend(writeDraftSend({}, failed))).toEqual(failed);
  });

  it("reads nothing when there is nothing, or when the record is malformed", () => {
    expect(readDraftSend(null)).toBeNull();
    expect(readDraftSend({})).toBeNull();
    expect(readDraftSend({ send: { state: "mystery" } })).toBeNull();
    expect(readDraftSend({ send: { state: "sent" } })).toBeNull();
  });
});

describe("decideSendClaim", () => {
  const now = new Date("2026-08-01T12:00:00.000Z");

  it("claims a draft a person is looking at, in any pre-send state", () => {
    for (const reviewState of ["draft", "needs_human_review", "approved", "send_failed"]) {
      expect(decideSendClaim({ reviewState }, now)).toEqual({ kind: "claim" });
    }
  });

  it("replays a completed send instead of ever sending twice", () => {
    const send: DraftSend = {
      state: "sent",
      idempotencyKey: "send:d1",
      attemptedAt: "2026-08-01T10:00:00.000Z",
      sentAt: "2026-08-01T10:00:04.000Z",
      providerMessageId: "gmail-msg-1",
    };
    const rationale = writeDraftSend({}, send);
    const decision = decideSendClaim({ reviewState: "sent", rationale }, now);
    expect(decision).toEqual({ kind: "replay", send });
  });

  it("refuses a draft marked sent by hand — Comms never re-sends what a person says went out", () => {
    const decision = decideSendClaim({ reviewState: "sent", rationale: {} }, now);
    expect(decision.kind).toBe("not_sendable");
  });

  it("holds a fresh claim as in flight — the double-click guard", () => {
    const rationale = writeDraftSend({}, SEND);
    const decision = decideSendClaim(
      { reviewState: "sending", rationale, updatedAt: "2026-08-01T11:55:00.000Z" },
      now,
    );
    expect(decision.kind).toBe("in_flight");
  });

  it("lets a stale claim be reclaimed — a died-mid-flight attempt is retryable", () => {
    const rationale = writeDraftSend({}, SEND);
    const staleAt = new Date(now.getTime() - STALE_SENDING_MS - 1000).toISOString();
    const decision = decideSendClaim({ reviewState: "sending", rationale, updatedAt: staleAt }, now);
    expect(decision.kind).toBe("claim");
  });

  it("never sends a discarded draft", () => {
    const decision = decideSendClaim({ reviewState: "discarded" }, now);
    expect(decision).toEqual({ kind: "not_sendable", reason: "This draft was discarded." });
  });
});
