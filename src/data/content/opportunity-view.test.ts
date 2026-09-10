import { describe, expect, it } from "vitest";

import { readContentDemand } from "@/data/website/content-demand";
import { deriveOpportunities } from "@/data/content/opportunity-read";
import type { SearchMetricsDay, WebsitePage } from "@/domain/website-analytics";

import {
  QUIET_LINE,
  UNREAD_LINE,
  formatCount,
  formatPosition,
  formatRate,
  formatWindow,
  studioOpportunitiesView,
} from "./opportunity-view";

function row(over: Partial<SearchMetricsDay>): SearchMetricsDay {
  return {
    date: "2026-08-01",
    query: "advisory that sticks",
    path: "/services",
    clicks: 3,
    impressions: 40,
    position: 9,
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

const eightDays = Array.from({ length: 8 }, (_, index) => row({ date: `2026-08-0${index + 1}` }));

function view(rows: SearchMetricsDay[], pages: WebsitePage[] | undefined = [page("/services")]) {
  const demand = readContentDemand(
    pages ? { searchMetrics: rows, pages } : { searchMetrics: rows, inventoryRead: false },
  );
  return studioOpportunitiesView(
    demand,
    deriveOpportunities({ organizationId: "org", demand, asOf: "2026-09-10T00:00:00.000Z" }),
  );
}

describe("formatting", () => {
  it("says not reported rather than zero for unknown metrics", () => {
    expect(formatCount(null)).toBe("Not reported");
    expect(formatRate(null)).toBe("Not reported");
    expect(formatPosition(null)).toBe("Not reported");
  });

  it("keeps a measured zero as a zero", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatRate(0)).toBe("0.0%");
  });

  it("reports the window in days that actually carried data", () => {
    expect(
      formatWindow({ start: "2026-08-01", end: "2026-08-08", daysWithData: 8, read: true }),
    ).toBe("1 Aug – 8 Aug · 8 days with data");
  });

  it("names an unread window instead of inventing one", () => {
    expect(formatWindow({ start: null, end: null, daysWithData: 0, read: false })).toBe(
      "No observed window",
    );
  });
});

describe("studioOpportunitiesView", () => {
  it("is unread, not empty, when search returned nothing", () => {
    const result = view([]);
    expect(result.state).toBe("unread");
    expect(result.rows).toHaveLength(0);
    expect(result.quietLine).toBe(UNREAD_LINE);
  });

  it("goes quiet rather than promoting thin demand", () => {
    const result = view([row({ impressions: 2 })]);
    expect(result.state).toBe("quiet");
    expect(result.rows).toHaveLength(0);
    expect(result.quietLine).toBe(QUIET_LINE);
  });

  it("never shows rows and a quiet line at the same time", () => {
    const active = view(eightDays);
    expect(active.state).toBe("active");
    expect(active.rows.length).toBeGreaterThan(0);
    expect(active.quietLine).toBe("");
  });

  it("keeps observed evidence separate from Studio's read", () => {
    const [first] = view(eightDays).rows;
    expect(first?.impressions).toBe("320");
    expect(first?.interpretation.length).toBeGreaterThan(0);
    expect(first?.moveLabel.length).toBeGreaterThan(0);
  });

  it("does not recommend a new post when the inventory was not read", () => {
    const result = view(eightDays, undefined);
    for (const entry of result.rows) expect(entry.move).not.toBe("new_post");
  });

  it("drops rows a person set aside, without writing anything", () => {
    const demand = readContentDemand({ searchMetrics: eightDays, pages: [page("/services")] });
    const opportunities = deriveOpportunities({
      organizationId: "org",
      demand,
      asOf: "2026-09-10T00:00:00.000Z",
    });
    const result = studioOpportunitiesView(demand, opportunities, [opportunities[0]!.id]);
    expect(result.rows.some((entry) => entry.id === opportunities[0]!.id)).toBe(false);
  });
});
