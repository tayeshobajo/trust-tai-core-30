/**
 * P4-04: coverage is reported as counts only.
 *
 * No percentage, no composite score, no health label, and never-read is a
 * sentence rather than a zero.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { computeCoverage } from "@/data/prospect-modules";
import { watchlistCoverage } from "@/data/scout/sweep";
import { computeDecisionMetrics } from "@/data/scout-intel";
import type { ProspectCandidate, ScoutSignal } from "@/domain/scout";

function signal(id: string): ScoutSignal {
  return {
    id,
    statement: `Observed fact ${id}`,
    provenance: {
      kind: "observed",
      source: "public website",
    } as unknown as ScoutSignal["provenance"],
  };
}

function candidate(overrides: Partial<ProspectCandidate> = {}): ProspectCandidate {
  return {
    prospect: {
      id: "p1",
      organizationId: "o1",
      companyName: "Acme",
      status: "new",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
    } as unknown as ProspectCandidate["prospect"],
    signals: [signal("a"), signal("b"), signal("c")],
    fit: { whyItFits: "", recommendation: "" },
    source: { kind: "live_website", label: "Public website" },
    evaluation: {
      score: 70,
      light: "green",
      evidenceCount: 3,
      strongestSignal: "",
      criteria: [],
      icpVersion: 1,
      evaluatorVersion: "trust-tai-icp-v3",
      evaluatedAt: "2026-09-01T00:00:00.000Z",
      explanation: "",
      scoreable: true,
      pagesResearched: 11,
    },
    lastCheckedAt: "2026-09-01T00:00:00.000Z",
    facts: {
      offer_page_checked: true,
      proof_page_checked: true,
      team_page_checked: false,
      contact_page_checked: false,
    },
    ...overrides,
  } as ProspectCandidate;
}

describe("coverage is counts only", () => {
  it("reports pages, kinds and facts as counts, never a percentage", () => {
    const coverage = computeCoverage(candidate());
    expect(coverage).not.toHaveProperty("percent");
    expect(coverage.pages).toBe(11);
    expect(coverage.facts).toBe(3);
    expect(coverage.reached).toBe(2);
    expect(coverage.checked).toHaveLength(4);
    expect(coverage.note).not.toMatch(/%/);
    expect(coverage.state).toBe("read");
  });

  it("says a never-read company is not researched, rather than zero", () => {
    const coverage = computeCoverage(
      candidate({
        signals: [],
        lastCheckedAt: "",
        evaluation: {
          ...candidate().evaluation,
          pagesResearched: 0,
          scoreable: false,
        },
        facts: {},
      }),
    );
    expect(coverage.state).toBe("never_read");
    expect(coverage.note).toMatch(/Not researched yet/);
    expect(coverage.note).not.toMatch(/0 page/);
  });

  it("says a site could not be read, and does not call that a loss", () => {
    const coverage = computeCoverage(
      candidate({
        signals: [],
        facts: {},
        evaluation: { ...candidate().evaluation, pagesResearched: 0 },
      }),
    );
    expect(coverage.state).toBe("unreadable");
    expect(coverage.note).toMatch(/could not be read/);
    expect(coverage.note).not.toMatch(/gap|failed|bad/i);
  });

  it("reports nothing for a preview record", () => {
    const coverage = computeCoverage(
      candidate({ source: { kind: "preview_demo", label: "Preview demo source" } }),
    );
    expect(coverage.state).toBe("never_read");
    expect(coverage.note).toMatch(/nothing to report/);
  });

  it("reports pages only when the pass predates page-kind recording", () => {
    const coverage = computeCoverage(candidate({ facts: {} }));
    expect(coverage.checked).toHaveLength(0);
    expect(coverage.note).toMatch(/11 public pages read/);
    expect(coverage.note).toMatch(/Page kinds were not recorded/);
  });

  it("reports every kind reached without ever saying 100%", () => {
    const coverage = computeCoverage(
      candidate({
        facts: {
          offer_page_checked: true,
          proof_page_checked: true,
          team_page_checked: true,
          contact_page_checked: true,
        },
      }),
    );
    expect(coverage.reached).toBe(4);
    expect(coverage.note).not.toMatch(/%/);
  });

  it("counts facts as observed rows held, not the fit evidence count", () => {
    const coverage = computeCoverage(
      candidate({
        signals: [signal("a")],
        evaluation: { ...candidate().evaluation, evidenceCount: 9 },
      }),
    );
    expect(coverage.facts).toBe(1);
  });

  it("leaves the coverage decision metric unknown rather than zero", () => {
    const metrics = computeDecisionMetrics({
      candidate: candidate(),
      intel: { people: [], buyingSignals: [], opportunities: [] },
      people: [],
      coverage: computeCoverage(candidate()),
    } as unknown as Parameters<typeof computeDecisionMetrics>[0]);
    const coverageMetric = metrics.metrics.find((metric) => metric.key === "research_coverage");
    expect(coverageMetric?.value).toBeNull();
  });

  it("summarises the watched list as counts, and only the watched list", () => {
    const watched = watchlistCoverage([
      candidate({
        watchlist: { at: "x" } as unknown as NonNullable<ProspectCandidate["watchlist"]>,
      }),
      candidate({
        watchlist: { at: "x" } as unknown as NonNullable<ProspectCandidate["watchlist"]>,
        signals: [],
        facts: {},
        lastCheckedAt: "",
        evaluation: { ...candidate().evaluation, pagesResearched: 0 },
      }),
      candidate(),
    ]);
    expect(watched.watched).toBe(2);
    expect(watched.read).toBe(1);
    expect(watched.neverRead).toBe(1);
    expect(watched.line).toBe("2 watched · 1 read · 1 never read");
    expect(watched.line).not.toMatch(/%/);
  });

  it("renders no percentage in the coverage surfaces", () => {
    for (const path of [
      "src/components/tt/prospect/coverage.tsx",
      "src/components/tt/scout/support-rail.tsx",
      "src/components/tt/scout/sweep-strip.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      expect(source).not.toMatch(/\* 100\)/);
      expect(source).not.toMatch(/}%`/);
    }
  });
});
