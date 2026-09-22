import { describe, expect, it } from "vitest";

import {
  decideFollowup,
  dueAtForTouch,
  FOLLOWUP_MAX_TOUCHES,
  FOLLOWUP_TOUCH_DAYS,
  type FollowupInput,
} from "./followup-cadence";

const NOW = new Date("2026-09-20T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * DAY);
}

function input(overrides: Partial<FollowupInput> = {}): FollowupInput {
  return {
    lastOutboundAt: daysAgo(5),
    repliedAfterLastOutbound: false,
    lastTouchNo: 0,
    now: NOW,
    ...overrides,
  };
}

describe("decideFollowup — the safety guardrails", () => {
  it("never follows up on someone who replied (the embarrassing case)", () => {
    const d = decideFollowup(input({ repliedAfterLastOutbound: true, lastTouchNo: 0 }));
    expect(d.action).toBe("mark_replied");
    expect(d.touchNo).toBeNull();
    expect(d.nextDueAt).toBeNull();
  });

  it("reply wins even when a touch is technically overdue", () => {
    const d = decideFollowup(
      input({ lastOutboundAt: daysAgo(30), repliedAfterLastOutbound: true, lastTouchNo: 1 }),
    );
    expect(d.action).toBe("mark_replied");
  });

  it("never follows up when we never reached out (silence is the only trigger)", () => {
    const d = decideFollowup(input({ lastOutboundAt: null }));
    expect(d.action).toBe("none");
    expect(d.daysSinceOutbound).toBeNull();
  });
});

describe("decideFollowup — the day 4 / 10 cadence", () => {
  it("does not draft before day 4", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(3), lastTouchNo: 0 }));
    expect(d.action).toBe("none");
    expect(d.nextDueAt).toEqual(dueAtForTouch(daysAgo(3), 1));
  });

  it("drafts touch 1 exactly at day 4", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(4), lastTouchNo: 0 }));
    expect(d.action).toBe("draft_touch_1");
    expect(d.touchNo).toBe(1);
    // next_due_at should point at touch 2 (day 10).
    expect(d.nextDueAt).toEqual(dueAtForTouch(daysAgo(4), 2));
  });

  it("does not draft touch 2 before day 10 even after touch 1", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(7), lastTouchNo: 1 }));
    expect(d.action).toBe("none");
  });

  it("drafts touch 2 at day 10 when touch 1 already sent", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(10), lastTouchNo: 1 }));
    expect(d.action).toBe("draft_touch_2");
    expect(d.touchNo).toBe(2);
    // no touch after 2 → terminal next_due_at.
    expect(d.nextDueAt).toBeNull();
  });

  it("marks cold after touch 2 with continued silence", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(20), lastTouchNo: 2 }));
    expect(d.action).toBe("mark_cold");
    expect(d.nextDueAt).toBeNull();
  });
});

describe("decideFollowup — idempotency (no double-fire)", () => {
  it("does not re-draft touch 1 once it is recorded, even well past day 4", () => {
    // Day 8: touch 1 done, touch 2 (day 10) not yet due → nothing to do.
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(8), lastTouchNo: 1 }));
    expect(d.action).toBe("none");
  });

  it("a fresh anchor (new outbound) resets to touch 1 timing", () => {
    const d = decideFollowup(input({ lastOutboundAt: daysAgo(4), lastTouchNo: 0 }));
    expect(d.action).toBe("draft_touch_1");
  });
});

describe("cadence constants", () => {
  it("is a two-touch cadence at day 4 and 10", () => {
    expect(FOLLOWUP_TOUCH_DAYS).toEqual([4, 10]);
    expect(FOLLOWUP_MAX_TOUCHES).toBe(2);
  });
});
