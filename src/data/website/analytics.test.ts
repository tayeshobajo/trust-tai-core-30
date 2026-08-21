/**
 * Website room acceptance.
 *
 * Fixtures only. Nothing here reads production data, and nothing asserts a
 * number the fixtures did not supply.
 */

import { describe, expect, it } from "vitest";

import type { WebsiteEvent, WebsiteSubmission } from "@/domain/website";
import { EMPTY_STRUCTURED } from "@/domain/website";
import { EMPTY_CONTENT_INTENT, type PageMetricsDay, type SearchMetricsDay, type WebsitePage } from "@/domain/website-analytics";

import { buildContentRows } from "./content";
import { healthFindings } from "./health";
import { overviewObservations } from "./overview";
import {
  aiReferrals,
  buildPageRows,
  providerReadiness,
  sourceGroups,
  type WebsiteAnalyticsInput,
} from "./pages";
import {
  competingPages,
  contentOpportunities,
  queriesForPath,
  queryRows,
  strikingDistance,
} from "./search";
import { normalizePath, samePage } from "./url";

/* ---------------------------------------------------------------- fixtures */

function page(overrides: Partial<WebsitePage> & { path: string }): WebsitePage {
  return {
    id: overrides.path,
    organizationId: "org",
    title: overrides.path,
    pageType: "page",
    indexable: true,
    inSitemap: true,
    intent: EMPTY_CONTENT_INTENT,
    ...overrides,
  };
}

function dayList(count: number, from = "2026-07-01"): string[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: count }, (_, index) =>
    new Date(start + index * 86_400_000).toISOString().slice(0, 10),
  );
}

function metric(date: string, path: string, views: number): PageMetricsDay {
  return {
    date,
    path,
    views,
    users: views,
    landingSessions: views,
    engagedSessions: Math.round(views * 0.6),
    averageEngagementSeconds: 60,
  };
}

function search(
  date: string,
  query: string,
  path: string,
  clicks: number,
  impressions: number,
  position = 8,
): SearchMetricsDay {
  return { date, query, path, clicks, impressions, position };
}

function event(overrides: Partial<WebsiteEvent> & { eventName: WebsiteEvent["eventName"] }): WebsiteEvent {
  return {
    id: Math.random().toString(36).slice(2),
    organizationId: "org",
    occurredAt: "2026-07-10T09:00:00Z",
    eventKey: Math.random().toString(36).slice(2),
    utm: {},
    properties: {},
    ...overrides,
  } as WebsiteEvent;
}

function submission(overrides: Partial<WebsiteSubmission> = {}): WebsiteSubmission {
  return {
    id: Math.random().toString(36).slice(2),
    organizationId: "org",
    submissionId: "sub",
    sourceApp: "website",
    sourceChannel: "website",
    sourceType: "roadmap_intake",
    submittedAt: "2026-07-12T10:00:00Z",
    receivedAt: "2026-07-12T10:00:01Z",
    attribution: {},
    person: {},
    company: {},
    verbatim: [],
    structured: EMPTY_STRUCTURED,
    signals: {},
    consent: {},
    linkState: "unlinked",
    linkReason: "",
    ...overrides,
  };
}

/* --------------------------------------------------------------- 1, 2 join */

describe("page representation and joining", () => {
  it("represents every public page even without provider data", () => {
    const rows = buildPageRows({
      pages: [page({ path: "/" }), page({ path: "/roadmap" }), page({ path: "/about" })],
      pageMetrics: [],
      searchMetrics: [],
      events: [],
      submissions: [],
    });
    expect(rows.map((row) => row.path).sort()).toEqual(["/", "/about", "/roadmap"]);
  });

  it("joins page and search metrics on a normalized url", () => {
    expect(normalizePath("https://trusttai.com/Roadmap/?utm=x#a")).toBe("/roadmap");
    expect(samePage("/roadmap", "https://www.trusttai.com/roadmap/")).toBe(true);

    const rows = buildPageRows({
      pages: [page({ path: "/roadmap" })],
      pageMetrics: [metric("2026-07-01", "/Roadmap/", 10)],
      searchMetrics: [search("2026-07-01", "roadmap", "https://trusttai.com/roadmap", 5, 100)],
      events: [],
      submissions: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.views).toBe(10);
    expect(rows[0]!.clicks).toBe(5);
    expect(rows[0]!.ctr).toBeCloseTo(0.05);
  });
});

/* --------------------------------------------------- 3 intake attribution */

describe("intake attribution", () => {
  it("connects a landing page to the conversation and to Scout", () => {
    const rows = buildPageRows({
      pages: [page({ path: "/roadmap" })],
      pageMetrics: [],
      searchMetrics: [],
      events: [
        event({ eventName: "page_view", sessionId: "s1", path: "/roadmap" }),
        event({ eventName: "intake_started", sessionId: "s1", path: "/intake" }),
      ],
      submissions: [
        submission({ attribution: { landingPath: "/roadmap" }, scoutStatus: "qualified" }),
      ],
    });
    const roadmap = rows.find((row) => row.path === "/roadmap");
    expect(roadmap?.intakeStarts).toBe(1);
    expect(roadmap?.intakeSubmissions).toBe(1);
    expect(roadmap?.qualified).toBe(1);
  });
});

/* ------------------------------------------------------ 4 unknown vs zero */

describe("missing provider data", () => {
  const input: WebsiteAnalyticsInput = {
    pages: [page({ path: "/roadmap" })],
    pageMetrics: [],
    searchMetrics: [],
    events: [],
    submissions: [],
  };

  it("keeps unmeasured columns unknown rather than zero", () => {
    const row = buildPageRows(input)[0]!;
    expect(row.views).toBeNull();
    expect(row.clicks).toBeNull();
    expect(row.ctr).toBeNull();
    expect(row.intakeStarts).toBeNull();
    // Submissions live in Core, so their absence really is zero.
    expect(row.intakeSubmissions).toBe(0);
  });

  it("reports readiness from observed rows only", () => {
    const readiness = providerReadiness(input);
    expect(readiness.find((entry) => entry.id === "ga4")?.connected).toBe(false);
    expect(readiness.find((entry) => entry.id === "search_console")?.connected).toBe(false);
    expect(readiness.find((entry) => entry.id === "page_inventory")?.connected).toBe(true);
  });
});

/* ------------------------------------------------ 5, 7 content behaviour */

describe("content performance", () => {
  const dates = dayList(12);
  const early = dates.slice(0, 6);
  const late = dates.slice(6);

  const pages = [
    page({
      path: "/blog/founder-bottleneck",
      pageType: "blog",
      title: "The founder bottleneck",
      publishedAt: "2025-01-01T00:00:00Z",
      lastUpdatedAt: "2025-01-01T00:00:00Z",
    }),
  ];

  const pageMetrics = [
    ...early.map((date) => metric(date, "/blog/founder-bottleneck", 40)),
    ...late.map((date) => metric(date, "/blog/founder-bottleneck", 5)),
  ];
  const searchMetrics = [
    ...early.map((date) => search(date, "founder bottleneck", "/blog/founder-bottleneck", 3, 200)),
    ...late.map((date) => search(date, "founder bottleneck", "/blog/founder-bottleneck", 3, 200)),
  ];

  const input: WebsiteAnalyticsInput = {
    pages,
    pageMetrics,
    searchMetrics,
    events: [],
    submissions: [],
  };

  it("detects decay deterministically and recommends a refresh first", () => {
    const rows = buildContentRows({
      pageRows: buildPageRows(input),
      pages,
      pageMetrics,
      searchMetrics,
      now: new Date("2026-07-20T00:00:00Z"),
    });
    expect(rows[0]!.classifications).toContain("needs_refresh");
    expect(rows[0]!.reasons.join(" ")).toContain("Refresh this before writing another one");
  });

  it("stays quiet when the page is too young for a decay claim", () => {
    const young = [
      page({
        ...pages[0]!,
        path: pages[0]!.path,
        publishedAt: "2026-07-01T00:00:00Z",
        lastUpdatedAt: "2026-07-01T00:00:00Z",
      }),
    ];
    const rows = buildContentRows({
      pageRows: buildPageRows({ ...input, pages: young }),
      pages: young,
      pageMetrics,
      searchMetrics,
      now: new Date("2026-07-20T00:00:00Z"),
    });
    expect(rows[0]!.classifications).not.toContain("needs_refresh");
  });

  it("only measures published content and never becomes an editor", () => {
    const rows = buildContentRows({
      pageRows: buildPageRows(input),
      pages,
      pageMetrics,
      searchMetrics,
    });
    const row = rows[0] as unknown as Record<string, unknown>;
    for (const forbidden of ["draft", "body", "publish", "approve", "editor"]) {
      expect(Object.keys(row)).not.toContain(forbidden);
    }
  });
});

/* --------------------------------------------------- 6 search opportunity */

describe("search intelligence", () => {
  const dates = dayList(12);
  const rows: SearchMetricsDay[] = [
    ...dates.map((date) => search(date, "founder bottleneck", "/blog/bottleneck", 0, 40, 12)),
    ...dates.map((date) => search(date, "founder bottleneck", "/blog/overwhelm", 0, 30, 14)),
    ...dates.map((date) => search(date, "roadmap for founders", "/roadmap", 6, 60, 3)),
  ];

  it("finds striking distance queries deterministically", () => {
    const striking = strikingDistance(queryRows(rows)).map((row) => row.query);
    expect(striking).toContain("founder bottleneck");
    expect(striking).not.toContain("roadmap for founders");
  });

  it("names competing pages when two of ours share a query", () => {
    const competing = competingPages(rows);
    expect(competing[0]!.query).toBe("founder bottleneck");
    expect(competing[0]!.paths.map((entry) => entry.path).sort()).toEqual([
      "/blog/bottleneck",
      "/blog/overwhelm",
    ]);
  });

  it("recommends a refresh instead of a new post when coverage exists", () => {
    const opportunities = contentOpportunities(rows, ["/blog/bottleneck", "/roadmap"]);
    const bottleneck = opportunities.find((row) => row.query === "founder bottleneck");
    expect(bottleneck?.coverage).toBe("thin");
    expect(bottleneck?.refreshPath).toBe("/blog/bottleneck");
    expect(opportunities.find((row) => row.query === "roadmap for founders")).toBeUndefined();
  });
});

/* ------------------------------------------------------- 8 AI referrals */

describe("AI referrals", () => {
  it("groups assistant referrers as a source and claims nothing more", () => {
    const groups = sourceGroups(
      [
        event({ eventName: "page_view", referrer: "https://chatgpt.com/c/1", path: "/" }),
        event({ eventName: "page_view", referrer: "https://www.perplexity.ai/x", path: "/" }),
        event({ eventName: "page_view", referrer: "https://www.google.com/", path: "/" }),
      ],
      [],
    );
    const ai = groups.find((row) => row.source === "AI referrals");
    expect(ai?.visits).toBe(2);
    expect(groups.find((row) => row.source === "google.com")?.visits).toBe(1);
  });
});

/* --------------------------------------------------- 9, 10 boundaries */

describe("architecture boundaries", () => {
  it("produces observations only, with no execution path out of Website", () => {
    const observations = overviewObservations({
      pageRows: buildPageRows({
        pages: [page({ path: "/roadmap", title: "Roadmap" })],
        pageMetrics: [metric("2026-07-01", "/roadmap", 30)],
        searchMetrics: [],
        events: [],
        submissions: [],
      }),
      contentRows: [],
      queries: [],
      health: [],
      submissions: [submission()],
      readiness: [],
      windowDays: 30,
    });
    const text = JSON.stringify(observations).toLowerCase();
    expect(text).toContain("strongest entry point");
    expect(text).not.toContain("create a project");
    expect(text).not.toContain("generate a roadmap");
    for (const observation of observations) {
      expect(["working", "changing", "attention", "next_move"]).toContain(observation.lane);
    }
  });

  it("keeps the Website to Scout intake contract intact", () => {
    const rows = buildPageRows({
      pages: [],
      pageMetrics: [],
      searchMetrics: [],
      events: [],
      submissions: [
        submission({
          attribution: { landingPath: "/roadmap" },
          scoutProspectId: "prospect-1",
          scoutStatus: "ready_for_comms",
        }),
      ],
    });
    expect(rows[0]!.path).toBe("/roadmap");
    expect(rows[0]!.qualified).toBe(1);
  });

  it("reports health findings without turning into an SEO suite", () => {
    const pages = [
      page({ path: "/hidden", indexable: false }),
      page({ path: "/ok" }),
    ];
    const findings = healthFindings(
      buildPageRows({ pages, pageMetrics: [], searchMetrics: [], events: [], submissions: [] }),
      pages,
    );
    expect(findings.map((entry) => entry.id)).toContain("noindex");
    expect(JSON.stringify(findings)).not.toContain("score");
  });
});

describe("assistant referrals and source readiness", () => {
  it("groups only referrers we recognise and keeps the wider total separate", () => {
    const events = [
      event({ eventName: "page_view", path: "/", referrer: "https://chat.openai.com/" }),
      event({ eventName: "page_view", path: "/", referrer: "https://www.perplexity.ai/search" }),
      event({ eventName: "page_view", path: "/", referrer: "https://news.ycombinator.com/" }),
      event({ eventName: "page_view", path: "/" }),
    ];

    const summary = aiReferrals(events, []);
    expect(summary.visits).toBe(2);
    expect(summary.attributableVisits).toBe(3);
    expect(summary.unmeasured).toBe(false);
    expect(summary.rows.map((row) => row.host).sort()).toEqual([
      "chat.openai.com",
      "perplexity.ai",
    ]);
  });

  it("says nothing was measured when no first party events arrived", () => {
    expect(aiReferrals([], []).unmeasured).toBe(true);
  });

  it("reports the last day each source spoke", () => {
    const readiness = providerReadiness({
      pages: [],
      pageMetrics: [metric("2026-07-04", "/", 10)],
      searchMetrics: [],
      events: [],
      submissions: [],
    });

    const analytics = readiness.find((entry) => entry.id === "ga4");
    const searchSource = readiness.find((entry) => entry.id === "search_console");
    expect(analytics?.lastSyncedAt).toBe("2026-07-04T00:00:00.000Z");
    expect(analytics?.covers).toContain("Views");
    expect(searchSource?.connected).toBe(false);
    expect(searchSource?.lastSyncedAt).toBeNull();
  });

  it("narrows queries to one page", () => {
    const rows = [
      search("2026-07-01", "trust tai", "/", 3, 100),
      search("2026-07-01", "trust tai pricing", "/pricing", 1, 40),
    ];
    expect(queriesForPath(rows, "/pricing").map((row) => row.query)).toEqual(["trust tai pricing"]);
  });
});
