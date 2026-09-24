/**
 * Outcome fill: the laws that close the judgment memory's outcome leg.
 *
 * Deterministic only, filled once, never rewritten. Silence is computed
 * from timestamps, and no record means no write, ever.
 */

import { describe, expect, it } from "vitest";

import { buildDimensionalRecord } from "./dimensional-record";
import {
  NO_RESPONSE_WINDOW_DAYS,
  silenceOutcome,
  withRepliedOutcome,
  withSilenceOutcome,
} from "./outcome-fill";

const SENT_AT = "2026-09-01T12:00:00.000Z";
const REPLIED_AT = "2026-09-03T12:00:00.000Z";

function openRecord(): Record<string, unknown> {
  return buildDimensionalRecord({
    register: "scout_intro",
    decideAction: "warm_intro",
    relationshipStage: "new",
    confidence: 0.8,
    voice: "pass",
    truth: "pass",
    now: SENT_AT,
  }) as unknown as Record<string, unknown>;
}

describe("withRepliedOutcome", () => {
  it("fills a replied outcome with latency, channel, and a message pointer", () => {
    const filled = withRepliedOutcome(openRecord(), {
      sentAt: SENT_AT,
      repliedAt: REPLIED_AT,
      channel: "email",
      messageRef: "gmail-msg-1",
    });
    expect(filled).not.toBeNull();
    expect(filled?.["outcome"]).toBe("replied");
    expect(filled?.["outcome_observed_at"]).toBe(REPLIED_AT);
    expect(filled?.["outcome_detail"]).toEqual({
      channel: "email",
      message_ref: "gmail-msg-1",
      reply_latency_ms: 2 * 24 * 60 * 60 * 1000,
    });
    // Semantic classification is the judgment layer's call, not a timestamp's.
    expect(filled?.["outcome_semantic"]).toBeNull();
  });

  it("keeps the captured dimensions it did not rule on", () => {
    const filled = withRepliedOutcome(openRecord(), {
      sentAt: SENT_AT,
      repliedAt: REPLIED_AT,
      channel: "linkedin",
      messageRef: "touch-1",
    });
    expect(filled?.["voice"]).toBe("pass");
    expect(filled?.["confidence"]).toBe(0.8);
    expect(filled?.["captured_at"]).toBe(SENT_AT);
  });

  it("writes nothing when there is no dimensional record", () => {
    expect(
      withRepliedOutcome(null, {
        sentAt: SENT_AT,
        repliedAt: REPLIED_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
    expect(
      withRepliedOutcome("not-a-record", {
        sentAt: SENT_AT,
        repliedAt: REPLIED_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
  });

  it("never overwrites an outcome already filled", () => {
    const already = { ...openRecord(), outcome: "replied" };
    expect(
      withRepliedOutcome(already, {
        sentAt: SENT_AT,
        repliedAt: REPLIED_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
    const silenced = { ...openRecord(), outcome: "no_response_30d" };
    expect(
      withRepliedOutcome(silenced, {
        sentAt: SENT_AT,
        repliedAt: REPLIED_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
  });

  it("refuses a reply that predates the send", () => {
    expect(
      withRepliedOutcome(openRecord(), {
        sentAt: REPLIED_AT,
        repliedAt: SENT_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
  });

  it("refuses unparseable timestamps rather than inventing a latency", () => {
    expect(
      withRepliedOutcome(openRecord(), {
        sentAt: "not-a-date",
        repliedAt: REPLIED_AT,
        channel: "email",
        messageRef: "m",
      }),
    ).toBeNull();
  });
});

describe("silenceOutcome", () => {
  it("is null while the window is open", () => {
    const dayBefore = new Date(
      Date.parse(SENT_AT) + (NO_RESPONSE_WINDOW_DAYS - 1) * 86_400_000,
    ).toISOString();
    expect(silenceOutcome(SENT_AT, dayBefore)).toBeNull();
  });

  it("closes as no_response_30d exactly at the window", () => {
    const atWindow = new Date(
      Date.parse(SENT_AT) + NO_RESPONSE_WINDOW_DAYS * 86_400_000,
    ).toISOString();
    expect(silenceOutcome(SENT_AT, atWindow)).toBe("no_response_30d");
  });

  it("is null on bad timestamps", () => {
    expect(silenceOutcome("nope", REPLIED_AT)).toBeNull();
    expect(silenceOutcome(SENT_AT, "nope")).toBeNull();
  });
});

describe("withSilenceOutcome", () => {
  const NOW = new Date(Date.parse(SENT_AT) + 31 * 86_400_000).toISOString();

  it("fills the silence outcome once the window has passed", () => {
    const filled = withSilenceOutcome(openRecord(), { sentAt: SENT_AT, now: NOW, channel: null });
    expect(filled?.["outcome"]).toBe("no_response_30d");
    expect(filled?.["outcome_observed_at"]).toBe(NOW);
    expect(filled?.["outcome_detail"]).toEqual({ channel: null, days_waited: 31 });
    expect(filled?.["outcome_semantic"]).toBeNull();
  });

  it("writes nothing while the window is still open", () => {
    const soon = new Date(Date.parse(SENT_AT) + 5 * 86_400_000).toISOString();
    expect(withSilenceOutcome(openRecord(), { sentAt: SENT_AT, now: soon, channel: null })).toBeNull();
  });

  it("writes nothing without a record, and never overwrites a filled one", () => {
    expect(withSilenceOutcome(null, { sentAt: SENT_AT, now: NOW, channel: null })).toBeNull();
    const already = { ...openRecord(), outcome: "replied" };
    expect(withSilenceOutcome(already, { sentAt: SENT_AT, now: NOW, channel: null })).toBeNull();
  });
});
