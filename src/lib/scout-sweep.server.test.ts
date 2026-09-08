import { describe, expect, it } from "vitest";

import { candidateFromRow, sweepConfigured } from "./scout-sweep.server";
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
