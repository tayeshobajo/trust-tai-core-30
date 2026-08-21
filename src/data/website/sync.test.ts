/**
 * Acceptance for the Website ingestion path.
 *
 * The rules being proved are the restraint rules: discovery does not invent
 * pages, the parser does not invent fields, an upsert does not erase what
 * another room wrote, a failed fetch is not a deletion, and a missing
 * credential is not a zero.
 */

import { describe, expect, it } from "vitest";

import {
  classifyPageType,
  discoverPages,
  inventoryRow,
  isPublicPath,
  parsePageMetadata,
  parseSitemap,
  sameSite,
} from "./inventory";
import {
  backfillRange,
  ga4Date,
  ga4PageRows,
  searchConsoleRows,
  type ProviderRunReport,
} from "./providers";
import { providerState, withFreshness } from "./freshness";
import { syncPageInventory } from "@/lib/website-inventory.server";
import type { ProviderReadiness } from "@/domain/website-analytics";

const ORG = "org-1";
const ORIGIN = "https://trusttai.com";

describe("sitemap discovery", () => {
  it("reads a urlset and a sitemap index apart", () => {
    const index = parseSitemap(
      `<sitemapindex><sitemap><loc>${ORIGIN}/sitemap-pages.xml</loc></sitemap></sitemapindex>`,
    );
    expect(index.sitemaps).toEqual([`${ORIGIN}/sitemap-pages.xml`]);
    expect(index.urls).toEqual([]);

    const urls = parseSitemap(`<urlset><url><loc>${ORIGIN}/about</loc></url></urlset>`);
    expect(urls.urls).toEqual([`${ORIGIN}/about`]);
  });

  it("normalizes and dedupes slash, case and query variants", () => {
    const pages = discoverPages(
      [
        `${ORIGIN}/About/`,
        `${ORIGIN}/about`,
        `${ORIGIN}/about?utm_source=x`,
        `${ORIGIN}/about#team`,
        `${ORIGIN}//about//`,
      ],
      ORIGIN,
    );
    expect(pages).toEqual([{ path: "/about", url: `${ORIGIN}/about` }]);
  });

  it("enforces the same site boundary and skips private paths", () => {
    const pages = discoverPages(
      [`${ORIGIN}/work`, "https://example.com/work", `${ORIGIN}/admin/settings`, `${ORIGIN}/login`],
      ORIGIN,
    );
    expect(pages.map((page) => page.path)).toEqual(["/work"]);
    expect(sameSite("https://www.trusttai.com/x", ORIGIN)).toBe(true);
    expect(sameSite("https://notrusttai.com/x", ORIGIN)).toBe(false);
    expect(isPublicPath("/api/thing")).toBe(false);
  });
});

describe("metadata parsing", () => {
  it("reads only what the page states", () => {
    const meta = parsePageMetadata(
      `<html><head><title> How we work </title>
       <link rel="canonical" href="${ORIGIN}/how-we-work">
       <meta name="robots" content="index, follow">
       <meta property="article:published_time" content="2026-02-01T10:00:00Z">
       <script type="application/ld+json">{"@type":"BlogPosting","dateModified":"2026-03-02"}</script>
       </head><body><p>Copy that mentions strategy, pricing and roadmaps.</p></body></html>`,
    );
    expect(meta.title).toBe("How we work");
    expect(meta.canonicalUrl).toBe(`${ORIGIN}/how-we-work`);
    expect(meta.indexable).toBe(true);
    expect(meta.publishedAt).toBe("2026-02-01T10:00:00.000Z");
    expect(meta.lastUpdatedAt?.slice(0, 10)).toBe("2026-03-02");
    // Nothing in the copy invents a topic.
    expect(meta.topic).toBeNull();
  });

  it("stays silent when the page says nothing", () => {
    const meta = parsePageMetadata("<html><head></head><body>Hello</body></html>");
    expect(meta).toMatchObject({
      title: null,
      canonicalUrl: null,
      publishedAt: null,
      lastUpdatedAt: null,
      indexable: null,
      topic: null,
    });
  });

  it("honours a noindex header", () => {
    const meta = parsePageMetadata("<html></html>", "noindex, nofollow");
    expect(meta.indexable).toBe(false);
  });

  it("classifies only what the address or structured type states", () => {
    const bare = parsePageMetadata("<html></html>");
    expect(classifyPageType("/blog/first-post", bare)).toBe("blog");
    expect(classifyPageType("/case-studies/acme", bare)).toBe("case_study");
    expect(classifyPageType("/start", bare)).toBe("landing_page");
    expect(classifyPageType("/pricing", bare)).toBe("page");
  });
});

describe("inventory upsert shape", () => {
  it("omits fields it could not read so stored values survive", () => {
    const row = inventoryRow({
      organizationId: ORG,
      page: { path: "/pricing", url: `${ORIGIN}/pricing` },
      meta: parsePageMetadata("<html><head><title>Pricing</title></head></html>"),
      inSitemap: true,
    });
    expect(row["title"]).toBe("Pricing");
    expect(row["in_sitemap"]).toBe(true);
    expect("content_intent" in row).toBe(false);
    expect("primary_cta" in row).toBe(false);
    expect("topic" in row).toBe(false);
    expect("published_at" in row).toBe(false);
  });
});

/* ------------------------------------------------------------- sync worker */

function fakeClient() {
  const upserts: { table: string; rows: Record<string, unknown>[] }[] = [];
  return {
    upserts,
    from(table: string) {
      return {
        upsert(rows: Record<string, unknown>[]) {
          upserts.push({ table, rows });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
}

function fakeFetch(pages: Record<string, { status?: number; body: string; type?: string }>) {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    const entry = pages[new URL(url).pathname];
    if (!entry) return new Response("missing", { status: 404 });
    return new Response(entry.body, {
      status: entry.status ?? 200,
      headers: { "content-type": entry.type ?? "text/html" },
    });
  };
}

describe("inventory sync", () => {
  const site = {
    "/robots.txt": { body: `Sitemap: ${ORIGIN}/sitemap.xml`, type: "text/plain" },
    "/sitemap.xml": {
      body: `<urlset><url><loc>${ORIGIN}/</loc></url><url><loc>${ORIGIN}/pricing</loc></url><url><loc>${ORIGIN}/gone</loc></url></urlset>`,
      type: "application/xml",
    },
    "/": { body: "<html><head><title>Trust Tai</title></head></html>" },
    "/pricing": { body: "<html><head><title>Pricing</title></head></html>" },
    "/gone": { body: "server error", status: 500 },
  };

  it("writes one row per readable page and never deletes on failure", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch(site) as typeof fetch;
    try {
      const client = fakeClient();
      const summary = await syncPageInventory(client as never, {
        organizationId: ORG,
        origin: ORIGIN,
      });
      expect(summary.discovered).toBe(3);
      expect(summary.fetched).toBe(2);
      expect(summary.upserted).toBe(2);
      expect(summary.failed).toBe(1);
      expect(client.upserts).toHaveLength(1);
      expect(client.upserts[0]?.table).toBe("website_pages");
      const paths = client.upserts[0]?.rows.map((row) => row["path"]);
      expect(paths).toEqual(["/", "/pricing"]);
      // No delete of any kind was attempted.
      expect(JSON.stringify(client.upserts)).not.toContain("delete");
    } finally {
      globalThis.fetch = original;
    }
  });

  it("is safe on retry: the same run writes the same rows", async () => {
    const original = globalThis.fetch;
    globalThis.fetch = fakeFetch(site) as typeof fetch;
    try {
      const first = fakeClient();
      const second = fakeClient();
      await syncPageInventory(first as never, { organizationId: ORG, origin: ORIGIN });
      await syncPageInventory(second as never, { organizationId: ORG, origin: ORIGIN });
      const key = (client: ReturnType<typeof fakeClient>) =>
        client.upserts[0]?.rows.map((row) => `${row["organization_id"]}|${row["path"]}`);
      expect(key(first)).toEqual(key(second));
    } finally {
      globalThis.fetch = original;
    }
  });
});

/* ---------------------------------------------------------------- adapters */

describe("GA4 adapter", () => {
  const report: ProviderRunReport = {
    dimensionHeaders: [
      { name: "date" },
      { name: "pagePath" },
      { name: "pageTitle" },
      { name: "sessionSource" },
      { name: "sessionMedium" },
      { name: "deviceCategory" },
      { name: "country" },
    ],
    metricHeaders: [
      { name: "screenPageViews" },
      { name: "totalUsers" },
      { name: "sessions" },
      { name: "engagedSessions" },
      { name: "userEngagementDuration" },
    ],
    rows: [
      {
        dimensionValues: [
          { value: "20260801" },
          { value: "/Pricing/" },
          { value: "Pricing" },
          { value: "google" },
          { value: "organic" },
          { value: "desktop" },
          { value: "United Kingdom" },
        ],
        metricValues: [
          { value: "10" },
          { value: "5" },
          { value: "6" },
          { value: "4" },
          { value: "300" },
        ],
      },
      {
        dimensionValues: [
          { value: "20260801" },
          { value: "/pricing?x=1" },
          { value: "Pricing" },
          { value: "google" },
          { value: "organic" },
          { value: "desktop" },
          { value: "United Kingdom" },
        ],
        metricValues: [
          { value: "2" },
          { value: "1" },
          { value: "1" },
          { value: "1" },
          { value: "60" },
        ],
      },
    ],
  };

  it("maps into the neutral shape and merges duplicate keys once", () => {
    const rows = ga4PageRows(report, ORG);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organization_id: ORG,
      provider: "ga4",
      metric_date: "2026-08-01",
      path: "/pricing",
      views: 12,
      users: 6,
      engaged_sessions: 5,
      source: "google",
      device: "desktop",
    });
  });

  it("reads GA4 dates and bounds a backfill", () => {
    expect(ga4Date("20260801")).toBe("2026-08-01");
    expect(ga4Date("nonsense")).toBeNull();
    const range = backfillRange(3, new Date("2026-08-10T00:00:00Z"));
    expect(range).toEqual({ start: "2026-08-07", end: "2026-08-09" });
    expect(backfillRange(9999, new Date("2026-08-10T00:00:00Z")).start).toBe("2025-07-07");
  });
});

describe("Search Console adapter", () => {
  it("normalizes URLs, keeps one row per key and derives nothing it was not told", () => {
    const rows = searchConsoleRows(
      [
        {
          keys: ["2026-08-01", "Trust Tai", `${ORIGIN}/Pricing/`, "DESKTOP", "GBR"],
          clicks: 3,
          impressions: 40,
          ctr: 0.075,
          position: 8.4,
        },
        {
          keys: ["2026-08-01", "trust tai", `${ORIGIN}/pricing`, "DESKTOP", "GBR"],
          clicks: 1,
          impressions: 10,
          ctr: 0.1,
          position: 9.4,
        },
      ],
      ORG,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      provider: "search_console",
      metric_date: "2026-08-01",
      query: "trust tai",
      path: "/pricing",
      clicks: 4,
      impressions: 50,
      device: "desktop",
    });
    expect(rows[0]?.average_position).toBeCloseTo(8.6, 1);
    expect("ctr" in (rows[0] ?? {})).toBe(false);
  });
});

/* -------------------------------------------------------------- freshness */

const readiness = (id: string, connected: boolean, lastSyncedAt: string | null) =>
  ({
    id,
    label: id,
    connected,
    note: "",
    rows: connected ? 1 : 0,
    lastSyncedAt,
    covers: "",
  }) as ProviderReadiness;

describe("provider freshness", () => {
  it("tells not configured apart from zero", () => {
    const merged = withFreshness(
      [readiness("ga4", false, null)],
      [
        {
          provider: "ga4",
          configured: false,
          lastRunAt: null,
          lastSuccessAt: null,
          lastError: null,
          rowsWritten: 0,
        },
      ],
    );
    expect(merged[0]?.state).toBe("not_configured");
    expect(merged[0]?.rows).toBe(0);
    expect(merged[0]?.connected).toBe(false);
  });

  it("separates live, stale, quiet and failed", () => {
    const now = Date.parse("2026-08-10T00:00:00Z");
    expect(providerState(readiness("ga4", true, "2026-08-09T00:00:00Z"), undefined, now)).toBe(
      "live",
    );
    expect(providerState(readiness("ga4", true, "2026-07-01T00:00:00Z"), undefined, now)).toBe(
      "stale",
    );
    expect(
      providerState(
        readiness("ga4", false, null),
        {
          provider: "ga4",
          configured: true,
          lastRunAt: "2026-08-09T00:00:00Z",
          lastSuccessAt: "2026-08-09T00:00:00Z",
          lastError: null,
          rowsWritten: 0,
        },
        now,
      ),
    ).toBe("quiet");
    expect(
      providerState(
        readiness("ga4", true, "2026-08-09T00:00:00Z"),
        {
          provider: "ga4",
          configured: true,
          lastRunAt: "2026-08-10T00:00:00Z",
          lastSuccessAt: "2026-08-09T00:00:00Z",
          lastError: "GA4 read failed (403).",
          rowsWritten: 0,
        },
        now,
      ),
    ).toBe("failed");
  });
});
