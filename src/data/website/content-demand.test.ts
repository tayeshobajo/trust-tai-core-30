import { describe, expect, it } from "vitest";

import { actionableDemand, readContentDemand } from "./content-demand";
import type { SearchMetricsDay, WebsitePage } from "@/domain/website-analytics";

function row(over: Partial<SearchMetricsDay>): SearchMetricsDay {
  return {
    date: "2026-08-25",
    query: "trust tai",
    path: "/services",
    clicks: 1,
    impressions: 10,
    position: 8,
    ...over,
  };
}

function page(path: string): WebsitePage {
  return {
    id: path,
    organizationId: "org",
    path,
    title: path,
    pageType: "page",
    indexable: null,
    inSitemap: null,
    intent: { relatedContent: [] },
  };
}

describe("readContentDemand", () => {
  it("says unknown, not zero, when search has not been read", () => {
    const reading = readContentDemand({ searchMetrics: [], searchRead: false });
    expect(reading.signals).toEqual([]);
    expect(reading.thin).toBe(true);
    expect(reading.window.read).toBe(false);
    expect(reading.unknowns.join(" ")).toContain("unknown, not zero");
  });

  it("reports an empty window as unknown rather than no demand", () => {
    const reading = readContentDemand({ searchMetrics: [], searchRead: true });
    expect(reading.unknowns.join(" ")).toContain("unknown");
    expect(reading.window.daysWithData).toBe(0);
  });

  it("marks a sparse low impression window as thin and keeps the row visible", () => {
    const reading = readContentDemand({
      searchMetrics: [
        row({ query: "what is trustate", date: "2026-08-25", impressions: 2, clicks: 0 }),
        row({ query: "trusttroiai", date: "2026-08-27", impressions: 1, clicks: 0 }),
        row({ query: "trustarte", date: "2026-08-29", impressions: 1, clicks: 0 }),
      ],
      pages: [page("/services")],
    });

    expect(reading.signals).toHaveLength(3);
    expect(reading.signals.every((signal) => signal.thin)).toBe(true);
    expect(reading.thin).toBe(true);
    expect(actionableDemand(reading)).toEqual([]);
    expect(reading.signals[0]?.thinBecause.join(" ")).toContain("below the 50");
  });

  it("keeps change null when the window is too short to compare halves", () => {
    const reading = readContentDemand({
      searchMetrics: [row({ impressions: 100, clicks: 10 })],
      pages: [page("/services")],
    });
    expect(reading.signals[0]?.change).toBeNull();
    expect(reading.because.join(" ")).toContain("cannot be read");
  });

  it("uses the existing demand floor and weak CTR rule, not a new one", () => {
    const rows = Array.from({ length: 8 }, (_, index) =>
      row({
        date: `2026-08-0${index + 1}`,
        query: "operating system for founders",
        impressions: 40,
        clicks: 0,
        position: 9,
      }),
    );
    const reading = readContentDemand({ searchMetrics: rows, pages: [page("/services")] });
    const signal = reading.signals[0];
    expect(signal?.impressions).toBe(320);
    expect(signal?.meetsDemandFloor).toBe(true);
    expect(signal?.weakCtr).toBe(true);
    expect(signal?.strikingDistance).toBe(true);
    expect(signal?.thin).toBe(false);
    expect(signal?.change).toBe(0);
  });

  it("leaves coverage unknown when the inventory has not been read", () => {
    const reading = readContentDemand({
      searchMetrics: [row({ impressions: 100 })],
      inventoryRead: false,
    });
    expect(reading.signals[0]?.coverage.inInventory).toBeNull();
    expect(reading.unknowns.join(" ")).toContain("page inventory");
  });

  it("carries competing pages as evidence", () => {
    const rows = [
      row({ query: "advisory", path: "/services", impressions: 60 }),
      row({ query: "advisory", path: "/about", impressions: 50 }),
    ];
    const reading = readContentDemand({
      searchMetrics: rows,
      pages: [page("/services"), page("/about")],
    });
    expect(reading.signals[0]?.competing.map((entry) => entry.path).sort()).toEqual([
      "/about",
      "/services",
    ]);
  });

  it("records the observed window and its provenance", () => {
    const reading = readContentDemand({
      searchMetrics: [row({ date: "2026-08-25" }), row({ date: "2026-08-29" })],
      pages: [],
    });
    expect(reading.window).toMatchObject({
      read: true,
      start: "2026-08-25",
      end: "2026-08-29",
      daysWithData: 2,
      rowCount: 2,
    });
  });
});
