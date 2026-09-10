import { describe, expect, it } from "vitest";

import { readContentDemand } from "@/data/website/content-demand";
import type { SearchMetricsDay, WebsitePage } from "@/domain/website-analytics";

import { composeOpportunityReads, deriveOpportunities } from "./opportunity-read";

function row(over: Partial<SearchMetricsDay>): SearchMetricsDay {
  return {
    date: "2026-08-01",
    query: "advisory that sticks",
    path: "/services",
    clicks: 0,
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

const window = Array.from({ length: 8 }, (_, index) => row({ date: `2026-08-0${index + 1}` }));

function reading(rows: SearchMetricsDay[], pages: WebsitePage[] = [page("/services")]) {
  return readContentDemand({ searchMetrics: rows, pages });
}

const ASOF = "2026-09-10T00:00:00.000Z";

describe("deriveOpportunities", () => {
  it("recommends no action on thin data", () => {
    const [opportunity] = deriveOpportunities({
      organizationId: "org",
      demand: reading([row({ impressions: 2 })]),
      asOf: ASOF,
    });
    expect(opportunity?.action).toBe("no_action");
    expect(opportunity?.confidence).toBe("thin");
    expect(opportunity?.because.join(" ")).toContain("below the 50");
  });

  it("recommends updating the page that already ranks and is rarely clicked", () => {
    const [opportunity] = deriveOpportunities({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
    });
    expect(opportunity?.action).toBe("update_existing");
    expect(opportunity?.alternatives[0]?.action).toBe("new_post");
  });

  it("keeps competing pages as a conflict instead of resolving them", () => {
    const rows = [...window, ...window.map((entry) => ({ ...entry, path: "/about" }))];
    const [opportunity] = deriveOpportunities({
      organizationId: "org",
      demand: reading(rows, [page("/services"), page("/about")]),
      asOf: ASOF,
    });
    expect(opportunity?.conflicts[0]?.kind).toBe("competing_pages");
    expect(opportunity?.conflicts[0]?.paths.sort()).toEqual(["/about", "/services"]);
    expect(opportunity?.action).toBe("internal_link");
  });

  it("suggests something new when nothing in the inventory answers the phrase", () => {
    const [opportunity] = deriveOpportunities({
      organizationId: "org",
      demand: reading(window, [page("/blog")]),
      asOf: ASOF,
    });
    expect(opportunity?.action).toBe("new_post");
  });

  it("lets a recorded human decision stand over the inference", () => {
    const derived = deriveOpportunities({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
    });
    const id = derived[0]!.id;
    const [decided] = deriveOpportunities({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
      decisions: {
        [id]: { state: "dismissed", decidedBy: "tai", decidedAt: ASOF, note: "Not our language." },
      },
    });
    expect(decided?.decision.state).toBe("dismissed");
    expect(decided?.decision.decidedBy).toBe("tai");
  });

  it("reports unread search as null metrics, never zero", () => {
    const opportunities = deriveOpportunities({
      organizationId: "org",
      demand: readContentDemand({ searchMetrics: [], searchRead: false }),
      asOf: ASOF,
    });
    expect(opportunities).toEqual([]);
  });
});

describe("composeOpportunityReads", () => {
  it("puts demand in as observed and the action in as inferred", () => {
    const { reads } = composeOpportunityReads({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
    });
    const read = reads[0]!;
    expect(read.room).toBe("studio");
    expect(read.producedBy).toBe("deterministic");
    expect(read.capabilities.readOnly).toBe(true);
    expect(read.claims.find((claim) => claim.aspect === "demand")?.tier).toBe("observed");
    expect(read.claims.find((claim) => claim.aspect === "action")?.tier).toBe("inferred");
  });

  it("lets a decided action outrank the inferred one and keeps the loser visible", () => {
    const derived = deriveOpportunities({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
    });
    const id = derived[0]!.id;
    const { reads } = composeOpportunityReads({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
      decisions: { [id]: { state: "dismissed", decidedBy: "tai", decidedAt: ASOF } },
    });
    const read = reads[0]!;
    expect(read.claims.find((claim) => claim.aspect === "action")?.tier).toBe("decided");
    const conflict = read.conflicts.find((entry) => entry.aspect === "action");
    expect(conflict?.losing[0]?.tier).toBe("inferred");
  });

  it("withholds an unread provider rather than reporting no demand", () => {
    const { opportunities, reads } = composeOpportunityReads({
      organizationId: "org",
      demand: readContentDemand({ searchMetrics: [], searchRead: false }),
      asOf: ASOF,
    });
    expect(opportunities).toEqual([]);
    expect(reads).toEqual([]);
  });

  it("names reader intent as an unknown until a person or model says otherwise", () => {
    const { reads } = composeOpportunityReads({
      organizationId: "org",
      demand: reading(window),
      asOf: ASOF,
    });
    expect(reads[0]?.unknowns.join(" ")).toContain("intent");
  });
});
