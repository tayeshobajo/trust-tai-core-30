/**
 * Reconciliation tests for the shared weekly snapshot.
 *
 * These exist to prove one thing: the shared read path cannot drift from the
 * rooms that own the truth. They use the real production laws (`weeklyRevenue`,
 * `homeWeekNumbers`, `orderToday`) rather than restating them, so a fixture
 * here can never quietly redefine a commercial definition.
 */

import { describe, expect, it } from "vitest";

import { composeWeeklySnapshot } from "./weekly-snapshot";
import type { WeeklyScoreboard } from "./supabase/commercial-service";
import { weeklyRevenue } from "@/domain/revenue";
import { DEFAULT_WEEKLY_TARGETS } from "@/domain/weekly-targets";
import { orderToday, type TodayCandidate } from "@/domain/today-ordering";

const WEEK = { start: "2026-09-01T00:00:00.000Z", end: "2026-09-08T00:00:00.000Z" } as const;

const READ = { available: true } as const;

function board(overrides: Partial<WeeklyScoreboard> = {}): WeeklyScoreboard {
  return {
    week: { ...WEEK },
    timeZone: "America/New_York",
    timeZoneFallback: false,
    targets: { ...DEFAULT_WEEKLY_TARGETS },
    revenue: { runCents: 0, diagnoseCents: 0, buildCents: 0, totalCents: 0 },
    runClients: 0,
    proposalsSent: 0,
    discoveryCalls: 0,
    roadmapReviews: 0,
    firstTouches: 0,
    sources: {
      organization: READ,
      clients: READ,
      proposals: READ,
      targets: READ,
      touches: READ,
      tierChanges: READ,
      firstTouches: READ,
    },
    ...overrides,
  };
}

describe("weekly snapshot, commercial reconciliation", () => {
  it("passes the revenue law through untouched: a Run client at $3,500/mo, a signed proposal that never inflates Run", () => {
    // Exactly the law Clients uses. The snapshot must not recompute or adjust it.
    const law = weeklyRevenue({
      week: { ...WEEK },
      clients: [{ tier: "run", mrrCents: 350_000 }],
      signedProposals: [{ occurredAt: "2026-09-03T15:00:00.000Z", amountCents: 500_000 }],
      buildPhases: [],
    });

    const snapshot = composeWeeklySnapshot(board({ revenue: law }));
    const revenue = snapshot.numbers.find((n) => n.key === "revenue");

    expect(snapshot.input.revenue).toEqual(law);
    expect(revenue?.value).toBe(law.totalCents);
    // The signed proposal is Diagnose, never recurring.
    expect(law.runCents).toBeGreaterThan(0);
    expect(law.diagnoseCents).toBe(500_000);
  });

  it("keeps Run clients a standing state count and out of the four numbers", () => {
    const snapshot = composeWeeklySnapshot(board({ runClients: 7 }));
    expect(snapshot.runClients).toBe(7);
    expect(snapshot.numbers.map((n) => n.key)).toEqual([
      "revenue",
      "first_touches",
      "discovery_calls",
      "proposals_sent",
    ]);
  });

  it("reads first touches and discovery calls from the same Comms sources the board used", () => {
    const snapshot = composeWeeklySnapshot(board({ firstTouches: 11, discoveryCalls: 2 }));
    expect(snapshot.numbers.find((n) => n.key === "first_touches")?.value).toBe(11);
    expect(snapshot.numbers.find((n) => n.key === "discovery_calls")?.value).toBe(2);
  });

  it("reads proposals sent from the same proposal source", () => {
    const snapshot = composeWeeklySnapshot(board({ proposalsSent: 1 }));
    expect(snapshot.numbers.find((n) => n.key === "proposals_sent")?.value).toBe(1);
  });
});

describe("weekly snapshot, unknown versus zero", () => {
  it("keeps an unreadable source unknown, never 0, and carries the owning source's reason", () => {
    const snapshot = composeWeeklySnapshot(
      board({
        firstTouches: null,
        sources: {
          ...board().sources,
          touches: { available: false, because: "comms_touches could not be read" },
          firstTouches: { available: false, because: "comms_touches could not be read" },
        },
      }),
    );

    const first = snapshot.numbers.find((n) => n.key === "first_touches");
    expect(first?.state).toBe("unknown");
    expect(first?.value).toBeNull();
    expect(first?.because).toBe("comms_touches could not be read");
    expect(snapshot.unreadable).toBe(true);
  });

  it("keeps a source that was read and was empty as a real 0", () => {
    const snapshot = composeWeeklySnapshot(board({ discoveryCalls: 0 }));
    const discovery = snapshot.numbers.find((n) => n.key === "discovery_calls");
    expect(discovery?.value).toBe(0);
    expect(discovery?.state).toBe("below_floor");
    expect(snapshot.unreadable).toBe(false);
  });

  it("never raises a floor breach from a number that could not be read", () => {
    const snapshot = composeWeeklySnapshot(
      board({
        firstTouches: null,
        sources: {
          ...board().sources,
          touches: { available: false, because: "unreadable" },
          firstTouches: { available: false, because: "unreadable" },
        },
      }),
    );
    expect(snapshot.floorCandidates.some((c) => c.key === "floor-first-touches")).toBe(false);
  });

  it("never raises a floor breach on revenue, which carries a goal and not an agreed floor", () => {
    const snapshot = composeWeeklySnapshot(
      board({
        revenue: { runCents: 0, diagnoseCents: 0, buildCents: 0, totalCents: 0 },
        targets: { ...DEFAULT_WEEKLY_TARGETS, revenueTargetCents: 1_000_000 },
      }),
    );
    expect(snapshot.floorCandidates.map((c) => c.key)).not.toContain("floor-revenue");
  });
});

describe("weekly snapshot, Today boundaries", () => {
  it("produces only floor breaches, never obligations: Projects owns obligation truth", () => {
    const snapshot = composeWeeklySnapshot(
      board({ firstTouches: 0, discoveryCalls: 0, proposalsSent: 0 }),
    );
    expect(snapshot.floorCandidates.length).toBeGreaterThan(0);
    expect(snapshot.floorCandidates.every((c) => c.kind === "floor_breach")).toBe(true);
  });

  it("keeps the deterministic order: obligation at risk, then floor breach, then decision", () => {
    const snapshot = composeWeeklySnapshot(board({ firstTouches: 0 }));
    const blocked: TodayCandidate = {
      key: "blocked-projects",
      kind: "obligation_at_risk",
      count: 1,
      label: "promise blocked in delivery",
      slug: "projects",
    };
    const decision: TodayCandidate = {
      key: "decisions",
      kind: "decision_opportunity",
      count: 3,
      label: "decisions waiting on you",
      slug: "approvals",
    };

    const ordered = orderToday([decision, ...snapshot.floorCandidates, blocked]);
    expect(ordered.map((c) => c.kind)).toEqual([
      "obligation_at_risk",
      ...snapshot.floorCandidates.map(() => "floor_breach" as const),
      "decision_opportunity",
    ]);
  });

  it("does not turn work that is merely in motion into an obligation", () => {
    // Nothing about an active week produces a Today card on its own.
    const snapshot = composeWeeklySnapshot(
      board({ firstTouches: 11, discoveryCalls: 3, proposalsSent: 2 }),
    );
    expect(snapshot.floorCandidates).toEqual([]);
  });
});

describe("weekly snapshot, one composition path", () => {
  it("gives two rooms identical values for the same organization and week", () => {
    const one = composeWeeklySnapshot(board({ firstTouches: 9, proposalsSent: 1 }));
    const two = composeWeeklySnapshot(board({ firstTouches: 9, proposalsSent: 1 }));
    expect(two).toEqual(one);
    expect(two.numbers).toEqual(one.numbers);
    expect(two.note).toEqual(one.note);
  });

  it("is deterministic and reads no clock: the note names the organization's own week", () => {
    const snapshot = composeWeeklySnapshot(board());
    expect(snapshot.note).toContain("America/New York");
    expect(snapshot.week).toEqual({ ...WEEK });
  });

  it("reports the fallback timezone as a fallback rather than adopting it silently", () => {
    const snapshot = composeWeeklySnapshot(
      board({
        timeZoneFallback: true,
        timeZoneBecause: "The organization's timezone could not be read.",
      }),
    );
    expect(snapshot.note).toBe("The organization's timezone could not be read.");
  });
});
