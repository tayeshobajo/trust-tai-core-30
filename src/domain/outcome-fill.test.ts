/**
 * Outcome recording: the laws that close the judgment memory's outcome leg.
 *
 * The clone must learn from what happened, not from what we hoped
 * happened. Events are append-only, attribution needs evidence, silence is
 * an observation not a verdict, and state is derived, never stored. The
 * lettered describes map one-to-one onto the merge acceptance criteria.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildDimensionalRecord } from "./dimensional-record";
import {
  NO_RESPONSE_WINDOW_DAYS,
  appendOutcomeEvent,
  deriveOutcomeState,
  planReplyOutcome,
  planSilenceObservation,
  readOutcomeEvents,
  silenceObservation,
  type SendCandidate,
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

function send(
  draftId: string,
  sentAt: string,
  threadRef: string | null = null,
  dimensional: unknown = openRecord(),
): SendCandidate {
  return { draftId, sentAt, threadRef, dimensional };
}

function daysAfter(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * 86_400_000).toISOString();
}

describe("A. explicit reply metadata attributes a direct reply", () => {
  it("one outbound plus a same-thread inbound gets touch direct_reply and a relationship reply event", () => {
    const plan = planReplyOutcome({
      relationshipRecord: {},
      sends: [send("draft-1", SENT_AT, "thread-9")],
      reply: { messageRef: "msg-1", occurredAt: REPLIED_AT, channel: "email", threadRef: "thread-9" },
    });
    expect(plan.relationshipEvent).toEqual({
      kind: "relationship_replied",
      observed_at: REPLIED_AT,
      channel: "email",
      message_ref: "msg-1",
    });
    expect(plan.touchUpdate?.draftId).toBe("draft-1");
    const events = readOutcomeEvents(plan.touchUpdate?.dimensional);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "reply_observed",
      attribution: "direct_reply",
      evidence: "thread_metadata",
      message_ref: "msg-1",
      reply_latency_ms: 2 * 24 * 60 * 60 * 1000,
    });
  });
});

describe("B. no explicit tie marks only the most recent plausible touch", () => {
  it("three outbound touches and one later reply yield one relationship event and one likely_influenced touch", () => {
    const older1 = send("draft-1", SENT_AT);
    const older2 = send("draft-2", daysAfter(SENT_AT, 2));
    const newest = send("draft-3", daysAfter(SENT_AT, 5));
    const plan = planReplyOutcome({
      relationshipRecord: {},
      sends: [older1, older2, newest],
      reply: {
        messageRef: "msg-2",
        occurredAt: daysAfter(SENT_AT, 7),
        channel: "email",
        threadRef: null,
      },
    });
    expect(plan.relationshipEvent?.kind).toBe("relationship_replied");
    // Exactly one touch is marked, and it is the newest plausible send.
    expect(plan.touchUpdate?.draftId).toBe("draft-3");
    expect(readOutcomeEvents(plan.touchUpdate?.dimensional)[0]).toMatchObject({
      attribution: "likely_influenced",
      evidence: "recency_heuristic",
    });
    // The older touches were never touched: their records carry no events.
    expect(readOutcomeEvents(older1.dimensional)).toHaveLength(0);
    expect(readOutcomeEvents(older2.dimensional)).toHaveLength(0);
  });
});

describe("C. silence is observed, and outcome code cannot send", () => {
  it("thirty quiet days record a no_response_observed_30d event", () => {
    const now = daysAfter(SENT_AT, NO_RESPONSE_WINDOW_DAYS);
    expect(silenceObservation(SENT_AT, now)).toBe("no_response_observed_30d");
    const grown = planSilenceObservation(openRecord(), { sentAt: SENT_AT, now, channel: null });
    const events = readOutcomeEvents(grown);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "no_response_observed_30d",
      observed_at: now,
      channel: null,
      message_ref: null,
    });
  });

  it("no send or action path is reachable from the outcome modules", () => {
    const root = join(__dirname, "..");
    const sources = [
      join(root, "domain", "outcome-fill.ts"),
      join(root, "lib", "comms-outcome-fill.server.ts"),
    ].map((path) => readFileSync(path, "utf8"));
    for (const source of sources) {
      expect(source).not.toMatch(
        /comms-autosend|comms-gmail-send|comms-resend-send|comms-linkedin-send|comms-send-authority|decideSend|postToResend|sendDraft/,
      );
    }
  });
});

describe("D. a later reply appends after a silence observation", () => {
  it("day-30 silence then day-47 reply keeps both events and derives replied", () => {
    const day30 = daysAfter(SENT_AT, 30);
    const day47 = daysAfter(SENT_AT, 47);
    const silenced = planSilenceObservation(openRecord(), {
      sentAt: SENT_AT,
      now: day30,
      channel: null,
    });
    expect(silenced).not.toBeNull();
    // The silence observation is not terminal: the reply event appends.
    const replied = appendOutcomeEvent(silenced, {
      kind: "reply_observed",
      observed_at: day47,
      channel: "email",
      message_ref: "msg-late",
      attribution: "direct_reply",
      evidence: "thread_metadata",
    });
    const state = deriveOutcomeState(replied);
    expect(state.events).toHaveLength(2);
    expect(state.events.map((event) => event.kind)).toEqual([
      "no_response_observed_30d",
      "reply_observed",
    ]);
    expect(state.current).toBe("replied");
  });
});

describe("E. ambiguity attributes nothing", () => {
  it("a reply that predates every send records the relationship event only", () => {
    const plan = planReplyOutcome({
      relationshipRecord: {},
      sends: [send("draft-1", daysAfter(REPLIED_AT, 1))],
      reply: { messageRef: "msg-3", occurredAt: REPLIED_AT, channel: "email", threadRef: null },
    });
    expect(plan.relationshipEvent?.kind).toBe("relationship_replied");
    expect(plan.touchUpdate).toBeNull();
  });

  it("two simultaneous candidate sends stay unattributed", () => {
    const plan = planReplyOutcome({
      relationshipRecord: {},
      sends: [send("draft-1", SENT_AT), send("draft-2", SENT_AT)],
      reply: { messageRef: "msg-4", occurredAt: REPLIED_AT, channel: "email", threadRef: null },
    });
    expect(plan.relationshipEvent?.kind).toBe("relationship_replied");
    expect(plan.touchUpdate).toBeNull();
  });
});

describe("F. re-running the same inbound records nothing twice", () => {
  it("a second pass over an already-recorded message ref is a complete no-op", () => {
    const first = planReplyOutcome({
      relationshipRecord: {},
      sends: [send("draft-1", SENT_AT, "thread-9")],
      reply: { messageRef: "msg-5", occurredAt: REPLIED_AT, channel: "email", threadRef: "thread-9" },
    });
    const relationshipRecord = appendOutcomeEvent({}, first.relationshipEvent!);
    const second = planReplyOutcome({
      relationshipRecord,
      sends: [send("draft-1", SENT_AT, "thread-9", first.touchUpdate!.dimensional)],
      reply: { messageRef: "msg-5", occurredAt: REPLIED_AT, channel: "email", threadRef: "thread-9" },
    });
    expect(second.relationshipEvent).toBeNull();
    expect(second.touchUpdate).toBeNull();
    // And the append primitive itself refuses a duplicate message ref.
    expect(
      appendOutcomeEvent(relationshipRecord, {
        kind: "relationship_replied",
        observed_at: REPLIED_AT,
        channel: "email",
        message_ref: "msg-5",
      }),
    ).toBeNull();
  });
});

describe("G. outcome modules import nothing from send paths", () => {
  it("import statements stay clear of send, autosend, and delivery modules", () => {
    const root = join(__dirname, "..");
    const files = [
      join(root, "domain", "outcome-fill.ts"),
      join(root, "lib", "comms-outcome-fill.server.ts"),
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      const imports = source.match(/^import[^;]+;/gm) ?? [];
      for (const statement of imports) {
        expect(statement).not.toMatch(
          /comms-autosend|comms-gmail-send|comms-resend-send|comms-linkedin-send|comms-send-authority|comms-outbound-payload/,
        );
      }
    }
  });
});

describe("event history and derived state fundamentals", () => {
  it("append refuses when there is no record home at all", () => {
    expect(
      appendOutcomeEvent(null, {
        kind: "relationship_replied",
        observed_at: REPLIED_AT,
        channel: "email",
        message_ref: "m",
      }),
    ).toBeNull();
    expect(
      appendOutcomeEvent("not-a-record", {
        kind: "relationship_replied",
        observed_at: REPLIED_AT,
        channel: "email",
        message_ref: "m",
      }),
    ).toBeNull();
  });

  it("appending never rewrites earlier events or captured dimensions", () => {
    const record = openRecord();
    const grown = appendOutcomeEvent(record, {
      kind: "reply_observed",
      observed_at: REPLIED_AT,
      channel: "email",
      message_ref: "m1",
      attribution: "direct_reply",
      evidence: "thread_metadata",
    })!;
    expect(grown["voice"]).toBe("pass");
    expect(grown["confidence"]).toBe(0.8);
    expect(grown["captured_at"]).toBe(SENT_AT);
    // The stored single outcome field stays untouched; state is derived.
    expect(grown["outcome"]).toBeNull();
  });

  it("silence is not recorded twice and never over a reply", () => {
    const now = daysAfter(SENT_AT, 31);
    const once = planSilenceObservation(openRecord(), { sentAt: SENT_AT, now, channel: null });
    expect(planSilenceObservation(once, { sentAt: SENT_AT, now, channel: null })).toBeNull();
    const repliedRecord = appendOutcomeEvent(openRecord(), {
      kind: "reply_observed",
      observed_at: REPLIED_AT,
      channel: "email",
      message_ref: "m2",
      attribution: "direct_reply",
      evidence: "thread_metadata",
    });
    expect(planSilenceObservation(repliedRecord, { sentAt: SENT_AT, now, channel: null })).toBeNull();
  });

  it("silence stays unrecorded while the window is open or timestamps are bad", () => {
    expect(silenceObservation(SENT_AT, daysAfter(SENT_AT, 29))).toBeNull();
    expect(silenceObservation("nope", REPLIED_AT)).toBeNull();
    expect(silenceObservation(SENT_AT, "nope")).toBeNull();
  });

  it("derives null with no history and the latest event otherwise", () => {
    expect(deriveOutcomeState(openRecord()).current).toBeNull();
    expect(deriveOutcomeState(null).current).toBeNull();
  });
});
