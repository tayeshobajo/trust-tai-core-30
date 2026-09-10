import { describe, expect, it } from "vitest";

import {
  DEFAULT_SWEEP_SETTINGS,
  SWEEP_PER_RUN_CAP,
  cadenceDue,
  SWEEP_WATCHLIST_SOFT_CAP,
  planSweep,
  summarizeSweep,
  type SweepCandidate,
} from "./sweep";

const NOW = "2026-09-08T12:00:00.000Z";
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number): string {
  return new Date(Date.parse(NOW) - days * DAY).toISOString();
}

function candidate(over: Partial<SweepCandidate> & { prospectId: string }): SweepCandidate {
  return {
    name: over.prospectId,
    websiteUrl: "https://example.com",
    lastResearchedAt: daysAgo(90),
    canResearch: true,
    permissionBecause: "",
    status: "discovered",
    ...over,
  };
}

describe("planning a bounded sweep", () => {
  it("defaults to automatic daily checking", () => {
    expect(DEFAULT_SWEEP_SETTINGS).toEqual({ enabled: true, cadence: "daily" });
  });

  it("reads no more than the per-run cap and defers the rest", () => {
    const many = Array.from({ length: SWEEP_PER_RUN_CAP + 4 }, (_, index) =>
      candidate({ prospectId: `c${index}`, lastResearchedAt: daysAgo(40 + index) }),
    );
    const plan = planSweep({ candidates: many, now: NOW });
    expect(plan.due).toHaveLength(SWEEP_PER_RUN_CAP);
    expect(plan.deferred).toBe(4);
  });

  it("reads oldest first, and never-checked before merely stale", () => {
    const plan = planSweep({
      candidates: [
        candidate({ prospectId: "stale", lastResearchedAt: daysAgo(40) }),
        candidate({ prospectId: "never", lastResearchedAt: null }),
        candidate({ prospectId: "older", lastResearchedAt: daysAgo(200) }),
      ],
      now: NOW,
    });
    expect(plan.due.map((target) => target.prospectId)).toEqual(["never", "older", "stale"]);
    expect(plan.due[0]?.reason).toBe("never_checked");
  });

  it("leaves fresh evidence alone and counts it as already current", () => {
    const plan = planSweep({
      candidates: [candidate({ prospectId: "fresh", lastResearchedAt: daysAgo(3) })],
      now: NOW,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.alreadyCurrent).toBe(1);
    expect(plan.summary).toMatch(/checked in the last 30 days/i);
  });

  it("reads fresh evidence again only when a person forces it", () => {
    const plan = planSweep({
      candidates: [candidate({ prospectId: "fresh", lastResearchedAt: daysAgo(3) })],
      now: NOW,
      force: true,
    });
    expect(plan.due).toHaveLength(1);
  });

  it("skips a company whose research permission is not settled, and says why", () => {
    const plan = planSweep({
      candidates: [
        candidate({
          prospectId: "blocked",
          canResearch: false,
          permissionBecause: "The intake never asked whether we may research them.",
        }),
      ],
      now: NOW,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped[0]?.because).toMatch(/never asked/i);
  });

  it("skips a company with no website rather than guessing one", () => {
    const plan = planSweep({
      candidates: [candidate({ prospectId: "nosite", websiteUrl: null })],
      now: NOW,
    });
    expect(plan.due).toHaveLength(0);
    expect(plan.skipped[0]?.because).toMatch(/no website/i);
  });

  it("leaves passed and archived companies out of the run entirely", () => {
    const plan = planSweep({
      candidates: [
        candidate({ prospectId: "passed", status: "passed" }),
        candidate({ prospectId: "archived", status: "archived" }),
      ],
      now: NOW,
    });
    expect(plan.watchedCount).toBe(0);
    expect(plan.due).toHaveLength(0);
  });

  it("flags a watchlist longer than one run can honestly cover", () => {
    const many = Array.from({ length: SWEEP_WATCHLIST_SOFT_CAP + 1 }, (_, index) =>
      candidate({ prospectId: `c${index}` }),
    );
    expect(planSweep({ candidates: many, now: NOW }).overSoftCap).toBe(true);
  });
});

describe("reporting what a sweep did", () => {
  const plan = planSweep({
    candidates: [
      candidate({ prospectId: "a" }),
      candidate({ prospectId: "b" }),
      candidate({ prospectId: "fresh", lastResearchedAt: daysAgo(2) }),
    ],
    now: NOW,
  });

  it("stays quiet when nothing changed", () => {
    const summary = summarizeSweep({
      plan,
      outcomes: [
        { prospectId: "a", name: "a", state: "read", changed: false },
        { prospectId: "b", name: "b", state: "read", changed: false },
      ],
    });
    expect(summary.quietLine).toBe("Checked. Nothing changed.");
    expect(summary.changed).toBe(0);
    expect(summary.countsLine).toContain("2 read");
    expect(summary.countsLine).toContain("1 already current");
  });

  it("reports counts only, never a percentage or a score", () => {
    const summary = summarizeSweep({
      plan,
      outcomes: [{ prospectId: "a", name: "a", state: "read", changed: true }],
    });
    expect(summary.countsLine).not.toMatch(/%/);
    expect(summary.quietLine).toBe("Checked. 1 company had new evidence.");
  });

  it("names what could not be read without downgrading the company", () => {
    const summary = summarizeSweep({
      plan,
      outcomes: [
        { prospectId: "a", name: "a", state: "read", changed: false },
        { prospectId: "b", name: "b", state: "unreadable", changed: false, because: "unreachable" },
      ],
    });
    expect(summary.unreadable).toBe(1);
    expect(summary.countsLine).toContain("1 could not be read");
  });

  it("says nothing was due when nothing was due", () => {
    const quiet = planSweep({
      candidates: [candidate({ prospectId: "fresh", lastResearchedAt: daysAgo(1) })],
      now: NOW,
    });
    expect(summarizeSweep({ plan: quiet, outcomes: [] }).quietLine).toMatch(/last 30 days/i);
  });
});

describe("honouring the chosen cadence", () => {
  it("is due when automatic checking has never run", () => {
    expect(cadenceDue({ cadence: "daily", lastRunAt: null, now: NOW })).toBe(true);
    expect(cadenceDue({ cadence: "weekly", lastRunAt: null, now: NOW })).toBe(true);
  });

  it("daily waits a full 24 hours", () => {
    const justUnder = new Date(Date.parse(NOW) - (DAY - 60_000)).toISOString();
    expect(cadenceDue({ cadence: "daily", lastRunAt: justUnder, now: NOW })).toBe(false);
    expect(cadenceDue({ cadence: "daily", lastRunAt: daysAgo(1), now: NOW })).toBe(true);
  });

  it("weekly waits a full 7 days, so a daily schedule cannot sweep it daily", () => {
    expect(cadenceDue({ cadence: "weekly", lastRunAt: daysAgo(1), now: NOW })).toBe(false);
    expect(cadenceDue({ cadence: "weekly", lastRunAt: daysAgo(6), now: NOW })).toBe(false);
    expect(cadenceDue({ cadence: "weekly", lastRunAt: daysAgo(7), now: NOW })).toBe(true);
  });

  it("measures elapsed time, never a local calendar day", () => {
    // 23 hours later is a new calendar day in UTC, but still not 24 hours.
    expect(
      cadenceDue({
        cadence: "daily",
        lastRunAt: "2026-09-07T23:00:00.000Z",
        now: "2026-09-08T22:00:00.000Z",
      }),
    ).toBe(false);
  });

  it("treats an unreadable timestamp as due rather than blocking forever", () => {
    expect(cadenceDue({ cadence: "daily", lastRunAt: "not a date", now: NOW })).toBe(true);
  });
});
