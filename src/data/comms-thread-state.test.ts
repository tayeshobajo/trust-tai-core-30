import { describe, expect, it } from "vitest";

import type { NormalizedMessage } from "@/domain/comms-integrations";

import {
  counterpartEmails,
  mergeMessages,
  newMessageCount,
  primaryCounterpart,
  readThread,
  touchSummary,
} from "./comms-thread-state";

const OURS = ["tai@trust-tai.com"];

function message(part: Partial<NormalizedMessage> & { providerMessageId: string }): NormalizedMessage {
  return {
    providerThreadId: "t1",
    direction: "inbound",
    toEmails: [],
    ccEmails: [],
    occurredAt: "2026-08-01T10:00:00.000Z",
    ...part,
  };
}

const inbound = message({
  providerMessageId: "m1",
  direction: "inbound",
  fromEmail: "dana@teamsynerg.com",
  toEmails: ["tai@trust-tai.com"],
  subject: "Following up on Nashville",
  occurredAt: "2026-08-01T10:00:00.000Z",
});

const outbound = message({
  providerMessageId: "m2",
  direction: "outbound",
  fromEmail: "tai@trust-tai.com",
  toEmails: ["dana@teamsynerg.com"],
  subject: "Re: Following up on Nashville",
  occurredAt: "2026-08-02T10:00:00.000Z",
});

describe("mergeMessages", () => {
  it("is idempotent: the same batch twice adds nothing", () => {
    const once = mergeMessages([], [inbound, outbound]);
    const twice = mergeMessages(once, [inbound, outbound]);
    expect(once).toHaveLength(2);
    expect(twice).toHaveLength(2);
  });

  it("orders by time regardless of arrival order", () => {
    const merged = mergeMessages([], [outbound, inbound]);
    expect(merged.map((m) => m.providerMessageId)).toEqual(["m1", "m2"]);
  });

  it("counts only messages not already on record", () => {
    expect(newMessageCount([inbound], [inbound, outbound])).toBe(1);
    expect(newMessageCount([inbound, outbound], [inbound, outbound])).toBe(0);
  });
});

describe("readThread", () => {
  it("is open with no messages", () => {
    const read = readThread([]);
    expect(read.state).toBe("open");
    expect(read.messageCount).toBe(0);
    expect(read.responseDueAt).toBeUndefined();
  });

  it("owes a reply when they wrote last, with a due time", () => {
    const read = readThread([outbound, inbound]);
    expect(read.state).toBe("waiting_on_us");
    expect(read.responseDueAt).toBe("2026-08-02T10:00:00.000Z");
    expect(read.lastInboundAt).toBe("2026-08-01T10:00:00.000Z");
  });

  it("waits on them when we wrote last, and owes nothing", () => {
    const read = readThread([inbound, outbound]);
    expect(read.state).toBe("waiting_on_them");
    expect(read.responseDueAt).toBeUndefined();
  });

  it("respects human-set closed and scheduled states", () => {
    expect(readThread([inbound], { closed: true }).state).toBe("closed");
    expect(readThread([inbound], { scheduled: true }).state).toBe("scheduled");
  });
});

describe("participants", () => {
  it("never returns our own addresses", () => {
    expect(counterpartEmails([inbound, outbound], OURS)).toEqual(["dana@teamsynerg.com"]);
  });

  it("prefers the person who wrote to us", () => {
    expect(primaryCounterpart([outbound, inbound], OURS)).toBe("dana@teamsynerg.com");
  });

  it("falls back to who we wrote to when there is no inbound", () => {
    expect(primaryCounterpart([outbound], OURS)).toBe("dana@teamsynerg.com");
  });

  it("returns nothing when every participant is us", () => {
    const selfOnly = message({
      providerMessageId: "m3",
      direction: "outbound",
      fromEmail: "tai@trust-tai.com",
      toEmails: ["tai@trust-tai.com"],
    });
    expect(primaryCounterpart([selfOnly], OURS)).toBeUndefined();
  });
});

describe("touchSummary", () => {
  it("says what actually happened, in the right direction", () => {
    expect(touchSummary(inbound)).toBe("They wrote: Following up on Nashville");
    expect(touchSummary(outbound)).toBe("We wrote: Re: Following up on Nashville");
  });
});
