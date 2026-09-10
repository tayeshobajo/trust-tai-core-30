import { describe, expect, it } from "vitest";

import { areasCovered, mergeObservedRows, planResearchRun } from "./research-run";
import type { ResearchPermission } from "./research-consent";

const allowed: ResearchPermission = {
  state: "granted",
  canResearch: true,
  because: "They authorised public research in the intake.",
} as ResearchPermission;

const blocked: ResearchPermission = {
  state: "unknown",
  canResearch: false,
  because: "Nobody has settled whether we may research them.",
} as ResearchPermission;

const coverage = (checkedCount: number) =>
  ({
    checkedCount,
    areas: [
      { key: "positioning", label: "Positioning", checked: checkedCount > 0 },
      { key: "search", label: "Search", checked: false },
    ],
  }) as never;

describe("planning a research run", () => {
  it("refuses to plan anything while permission is unsettled", () => {
    const plan = planResearchRun({
      coverage: coverage(0),
      permission: blocked,
      lastResearchedAt: null,
    });
    expect(plan.allowed).toBe(false);
    expect(plan.mode).toBe("blocked");
    expect(plan.blockedBecause).toMatch(/settled|permission|consent/i);
  });

  it("calls a first pass initial, not a re-run", () => {
    const plan = planResearchRun({
      coverage: coverage(0),
      permission: allowed,
      lastResearchedAt: null,
    });
    expect(plan.mode).toBe("initial");
    expect(plan.allowed).toBe(true);
  });

  it("only targets the areas that were never read when evidence is fresh", () => {
    const plan = planResearchRun({
      coverage: coverage(1),
      permission: allowed,
      lastResearchedAt: new Date().toISOString(),
    });
    expect(plan.mode).toBe("targeted");
    expect(plan.targets.map((t) => t.key)).toEqual(["search"]);
  });
});

describe("merging observations", () => {
  const rows = (statement: string, key = "positioning") => ({ key, statement, source_url: "u" });

  it("preserves observations a later pass did not reach", () => {
    const merge = mergeObservedRows({
      previous: [rows("Old positioning read"), rows("Old search read", "search")],
      incoming: [rows("New positioning read")],
    });
    expect(merge.merged).toHaveLength(2);
    expect(merge.replaced).toBe(1);
    expect(merge.kept).toBe(1);
    expect(merge.added).toBe(0);
  });

  it("reports which areas a pass actually covered", () => {
    expect(areasCovered([rows("a"), rows("b", "search")])).toEqual([
      "Website / positioning",
      "Search visibility",
    ]);
  });
});
