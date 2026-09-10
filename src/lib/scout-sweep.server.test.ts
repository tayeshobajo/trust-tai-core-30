import { describe, expect, it } from "vitest";

import { readFileSync } from "fs";

import { candidateFromRow, sweepConfigured, takeLease } from "./scout-sweep.server";
import { planSweep } from "@/data/scout/sweep";

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

function row(over: Record<string, unknown> = {}) {
  return {
    id: "p1",
    company_name: "Example Ltd",
    website_url: "https://example.com",
    status: "discovered",
    observed: [{ key: "positioning", statement: "s" }],
    provenance: { observed_at: ago(90) },
    metadata: { scout_watchlist: { method: "manual" } },
    ...over,
  };
}

describe("reading a stored watchlist row for the sweep", () => {
  it("treats a company that was never read as never checked", () => {
    const candidate = candidateFromRow(row({ observed: [] }));
    expect(candidate.lastResearchedAt).toBeNull();
    expect(planSweep({ candidates: [candidate] }).due[0]?.reason).toBe("never_checked");
  });

  it("refuses to read an inbound company whose permission was never settled", () => {
    const candidate = candidateFromRow(
      row({ metadata: { scout_watchlist: {}, stated: { what: "they told us" } } }),
    );
    expect(candidate.canResearch).toBe(false);
    expect(candidate.permissionBecause).toMatch(/not been settled/i);
  });

  it("honours a withheld research decision", () => {
    const candidate = candidateFromRow(
      row({
        metadata: {
          scout_watchlist: {},
          stated: { what: "x" },
          scout_research_consent: { decision: "withheld" },
        },
      }),
    );
    expect(candidate.canResearch).toBe(false);
    expect(planSweep({ candidates: [candidate] }).due).toHaveLength(0);
  });

  it("reads a company with granted permission", () => {
    const candidate = candidateFromRow(
      row({
        metadata: {
          scout_watchlist: {},
          stated: { what: "x" },
          scout_research_consent: { decision: "granted" },
        },
      }),
    );
    expect(candidate.canResearch).toBe(true);
    expect(planSweep({ candidates: [candidate] }).due).toHaveLength(1);
  });

  it("leaves a company with fresh evidence alone", () => {
    const candidate = candidateFromRow(row({ provenance: { observed_at: ago(2) } }));
    const plan = planSweep({ candidates: [candidate] });
    expect(plan.due).toHaveLength(0);
    expect(plan.alreadyCurrent).toBe(1);
  });

  it("reports honestly whether the scheduled half can run at all", () => {
    expect(typeof sweepConfigured()).toBe("boolean");
  });
});

/* --------------------------------------------------- cadence and the lease -- */

type FakeState = Record<string, unknown> | null;

function fakeDb(state: FakeState) {
  const upserts: Array<Record<string, unknown>> = [];
  const client = {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: state, error: null }) }),
        }),
        upsert: async (values: Record<string, unknown>) => {
          upserts.push(values);
          return { error: null };
        },
      };
    },
  };
  // The lease only ever touches select/eq/maybeSingle and upsert.
  return { db: client as unknown as Parameters<typeof takeLease>[0], upserts };
}

const AT = new Date("2026-09-08T12:00:00.000Z");
const hoursBefore = (hours: number) =>
  new Date(AT.getTime() - hours * 60 * 60 * 1000).toISOString();

describe("the scheduled half honours the chosen cadence", () => {
  it("runs when no automatic run has happened yet", async () => {
    const { db, upserts } = fakeDb({ enabled: true, cadence: "daily", last_run_at: null });
    expect(await takeLease(db, "org", AT)).toEqual({ taken: true });
    expect(upserts).toHaveLength(1);
  });

  it("refuses a second daily run inside 24 hours, and writes nothing", async () => {
    const { db, upserts } = fakeDb({
      enabled: true,
      cadence: "daily",
      last_run_at: hoursBefore(6),
      read_count: 4,
    });
    const decision = await takeLease(db, "org", AT);
    expect(decision.taken).toBe(false);
    expect(decision.taken === false && decision.because).toMatch(/last 24 hours/i);
    expect(upserts).toHaveLength(0);
  });

  it("keeps a weekly organization weekly even though the schedule fires daily", async () => {
    const recent = fakeDb({ enabled: true, cadence: "weekly", last_run_at: hoursBefore(24) });
    const later = await takeLease(recent.db, "org", AT);
    expect(later.taken).toBe(false);
    expect(later.taken === false && later.because).toMatch(/last 7 days/i);
    expect(recent.upserts).toHaveLength(0);

    const overdue = fakeDb({ enabled: true, cadence: "weekly", last_run_at: hoursBefore(24 * 8) });
    expect(await takeLease(overdue.db, "org", AT)).toEqual({ taken: true });
  });

  it("refuses when automatic checking is off", async () => {
    const { db, upserts } = fakeDb({ enabled: false, cadence: "daily", last_run_at: null });
    const decision = await takeLease(db, "org", AT);
    expect(decision.taken === false && decision.because).toMatch(/off/i);
    expect(upserts).toHaveLength(0);
  });

  it("refuses while another run holds the lease", async () => {
    const { db, upserts } = fakeDb({
      enabled: true,
      cadence: "daily",
      last_run_at: hoursBefore(48),
      lease_until: new Date(AT.getTime() + 60_000).toISOString(),
    });
    const decision = await takeLease(db, "org", AT);
    expect(decision.taken === false && decision.because).toMatch(/already in progress/i);
    expect(upserts).toHaveLength(0);
  });

  it("defaults to daily when no settings row exists yet", async () => {
    const { db } = fakeDb(null);
    expect(await takeLease(db, "org", AT)).toEqual({ taken: true });
  });
});

describe("a person checking by hand", () => {
  it("is independent of cadence: forcing reads fresh evidence again", () => {
    const candidate = candidateFromRow(row({ provenance: { observed_at: ago(1) } }));
    expect(planSweep({ candidates: [candidate] }).due).toHaveLength(0);
    expect(planSweep({ candidates: [candidate], force: true }).due).toHaveLength(1);
  });

  it("never passes through the scheduled lease", () => {
    // The manual path lives in scoutService.sweepWatchlist and plans directly,
    // so no cadence or lease check can stand between a person and a check.
    const source = readFileSync("src/data/supabase/scout-service.ts", "utf8");
    expect(source).not.toMatch(/takeLease|cadenceDue|lease_until/);
  });
});
