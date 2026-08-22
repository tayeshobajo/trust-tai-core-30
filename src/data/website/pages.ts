/**
 * The all pages view.
 *
 * Every public page can be represented individually, whether or not a provider
 * has reported on it yet. The rule from the intake room holds here too: a
 * number we cannot observe is null, never 0, because a page with no traffic and
 * a page we cannot see are different truths.
 */

import type {
  AiReferralRow,
  AiReferralSummary,
  PageMetricsDay,
  PageRow,
  ProviderReadiness,
  SearchMetricsDay,
  WebsitePage,
} from "@/domain/website-analytics";
import { AI_REFERRER_HOSTS } from "@/domain/website-analytics";
import type { KnownNumber, WebsiteEvent, WebsiteSubmission } from "@/domain/website";

import { isOperationalPath, normalizePath, referrerHost } from "./url";
import { isQualified } from "./projection";


export interface WebsiteAnalyticsInput {
  pages: WebsitePage[];
  pageMetrics: PageMetricsDay[];
  searchMetrics: SearchMetricsDay[];
  events: WebsiteEvent[];
  submissions: WebsiteSubmission[];
}

export const EMPTY_ANALYTICS: WebsiteAnalyticsInput = {
  pages: [],
  pageMetrics: [],
  searchMetrics: [],
  events: [],
  submissions: [],
};

const AI_HOSTS = new Set<string>(AI_REFERRER_HOSTS);

/* ------------------------------------------------------------- readiness */

const latest = (values: (string | null | undefined)[]): string | null => {
  let best: string | null = null;
  for (const value of values) {
    if (!value) continue;
    if (!best || value > best) best = value;
  }
  return best;
};

/** A date only row reports at day granularity. Keep it honest as a day. */
const dayToIso = (day: string | null): string | null =>
  day ? new Date(`${day.slice(0, 10)}T00:00:00Z`).toISOString() : null;

/**
 * What each source has actually reported.
 *
 * `connected` stays observational: it means rows arrived. Whether the source is
 * configured, quiet or failing is decided by the provider ledger in
 * withFreshness, so a successful run that returned nothing reads as quiet
 * rather than as an integration that was never set up.
 */
export function providerReadiness(input: WebsiteAnalyticsInput): ProviderReadiness[] {
  const gaOn = input.pageMetrics.length > 0;
  const searchOn = input.searchMetrics.length > 0;
  const eventsOn = input.events.length > 0;
  const healthKnown = input.pages.filter((page) => page.indexable !== null);

  return [
    {
      id: "page_inventory",
      label: "Page inventory",
      connected: input.pages.length > 0,
      rows: input.pages.length,
      lastSyncedAt: null,
      covers: "The list of public pages, their type and their intent.",
      note: "Core holds the canonical list of public pages.",
    },
    {
      id: "first_party_events",
      label: "First party events",
      connected: eventsOn,
      capabilityAvailable: true,
      rows: input.events.length,
      lastSyncedAt: latest(input.events.map((event) => event.occurredAt)),
      covers: "Visits by source, intake starts, reads and the funnel between them.",
      note: eventsOn
        ? "TrustTai.com is sending signed events."
        : "Connected. No first party events received in this window.",
    },
    {
      id: "ga4",
      label: "GA4 attention and behaviour",
      connected: gaOn,
      rows: input.pageMetrics.length,
      lastSyncedAt: dayToIso(latest(input.pageMetrics.map((row) => row.date))),
      covers: "Views, visitors, landing sessions, engagement rate and time on page.",
      note: "Daily page metrics for every public path.",
    },
    {
      id: "search_console",
      label: "Search Console discovery",
      connected: searchOn,
      rows: input.searchMetrics.length,
      lastSyncedAt: dayToIso(latest(input.searchMetrics.map((row) => row.date))),
      covers: "Queries, clicks, impressions, click through rate and average position.",
      note: "Query and page level search performance.",
    },
    {
      id: "site_health",
      label: "Site health",
      connected: input.pages.some((page) => page.indexable !== null || page.inSitemap !== null),
      capabilityAvailable: input.pages.length > 0,
      derivedFrom: "page_inventory",
      rows: healthKnown.length,
      lastSyncedAt: null,
      covers: "Indexing, sitemap presence and canonical addresses.",
      note: "Read from the page inventory when the site reports it.",
    },
  ];
}



/* ------------------------------------------------------------ intake joins */

interface IntakeByPath {
  starts: Map<string, number>;
  submissions: Map<string, number>;
  qualified: Map<string, number>;
  reads: Map<string, number>;
  measured: boolean;
}

const bump = (map: Map<string, number>, key: string, by = 1) =>
  map.set(key, (map.get(key) ?? 0) + by);

/**
 * Attribution runs on evidence only. A session's landing page is the first
 * page_view it produced; an intake event with no such session is counted on the
 * path the event itself carried, and never guessed.
 */
export function intakeByPath(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): IntakeByPath {
  const landing = new Map<string, string>();
  const ordered = [...events].sort((a, b) => a.occurredAt.localeCompare(b.occurredAt));
  for (const event of ordered) {
    if (event.eventName !== "page_view" || !event.sessionId) continue;
    if (!landing.has(event.sessionId)) landing.set(event.sessionId, normalizePath(event.path));
  }

  const starts = new Map<string, number>();
  const subs = new Map<string, number>();
  const qualified = new Map<string, number>();
  const reads = new Map<string, number>();

  for (const event of ordered) {
    const path =
      (event.sessionId ? landing.get(event.sessionId) : undefined) ?? normalizePath(event.path);
    if (event.eventName === "intake_started") bump(starts, path);
    if (event.eventName === "content_read") bump(reads, normalizePath(event.path));
  }

  for (const submission of submissions) {
    const path = normalizePath(submission.attribution.landingPath);
    bump(subs, path);
    if (isQualified(submission.scoutStatus)) bump(qualified, path);
  }

  return { starts, submissions: subs, qualified, reads, measured: events.length > 0 };
}

/* ------------------------------------------------------------------- rows */

interface Totals {
  views: number;
  users: number;
  landingSessions: number;
  engagedSessions: number;
  engagementSeconds: number;
  samples: number;
}

function accumulate(rows: PageMetricsDay[]): Map<string, Totals> {
  const byPath = new Map<string, Totals>();
  for (const row of rows) {
    const path = normalizePath(row.path);
    const totals = byPath.get(path) ?? {
      views: 0,
      users: 0,
      landingSessions: 0,
      engagedSessions: 0,
      engagementSeconds: 0,
      samples: 0,
    };
    totals.views += row.views;
    totals.users += row.users;
    totals.landingSessions += row.landingSessions;
    totals.engagedSessions += row.engagedSessions;
    totals.engagementSeconds += row.averageEngagementSeconds * Math.max(row.views, 1);
    totals.samples += Math.max(row.views, 1);
    byPath.set(path, totals);
  }
  return byPath;
}

interface SearchTotals {
  clicks: number;
  impressions: number;
  positionWeighted: number;
}

export function searchByPath(rows: SearchMetricsDay[]): Map<string, SearchTotals> {
  const byPath = new Map<string, SearchTotals>();
  for (const row of rows) {
    const path = normalizePath(row.path);
    const totals = byPath.get(path) ?? { clicks: 0, impressions: 0, positionWeighted: 0 };
    totals.clicks += row.clicks;
    totals.impressions += row.impressions;
    totals.positionWeighted += row.position * row.impressions;
    byPath.set(path, totals);
  }
  return byPath;
}

const ratio = (numerator: number, denominator: number): KnownNumber =>
  denominator > 0 ? numerator / denominator : null;

/** Join the page inventory to every provider that has actually reported. */
export function buildPageRows(input: WebsiteAnalyticsInput): PageRow[] {
  const ga = accumulate(input.pageMetrics);
  const search = searchByPath(input.searchMetrics);
  const intake = intakeByPath(input.events, input.submissions);

  const paths = new Set<string>();
  for (const page of input.pages) paths.add(normalizePath(page.path));
  for (const path of ga.keys()) paths.add(path);
  for (const path of search.keys()) paths.add(path);
  for (const path of intake.submissions.keys()) paths.add(path);
  /* Back office, sign in and error routes are not part of the public site. */
  for (const path of [...paths]) if (isOperationalPath(path)) paths.delete(path);


  const inventory = new Map(input.pages.map((page) => [normalizePath(page.path), page]));
  const gaOn = input.pageMetrics.length > 0;
  const searchOn = input.searchMetrics.length > 0;
  const eventsOn = intake.measured;

  const rows: PageRow[] = [];
  for (const path of paths) {
    const page = inventory.get(path);
    const traffic = ga.get(path);
    const found = search.get(path);
    const titleFromGa = input.pageMetrics.find((row) => normalizePath(row.path) === path)?.title;

    rows.push({
      path,
      title: page?.title || titleFromGa || path,
      pageType: page?.pageType ?? "page",
      publishedAt: page?.publishedAt ?? null,
      lastUpdatedAt: page?.lastUpdatedAt ?? null,
      indexable: page?.indexable ?? null,
      inSitemap: page?.inSitemap ?? null,
      canonicalUrl: page?.canonicalUrl ?? null,
      primaryCta: page?.primaryCta ?? null,
      unlisted: !page,

      views: gaOn ? (traffic?.views ?? 0) : null,
      users: gaOn ? (traffic?.users ?? 0) : null,
      landingSessions: gaOn ? (traffic?.landingSessions ?? 0) : null,
      engagedSessions: gaOn ? (traffic?.engagedSessions ?? 0) : null,
      engagementRate: traffic ? ratio(traffic.engagedSessions, traffic.landingSessions) : null,
      averageEngagementSeconds: traffic ? ratio(traffic.engagementSeconds, traffic.samples) : null,

      clicks: searchOn ? (found?.clicks ?? 0) : null,
      impressions: searchOn ? (found?.impressions ?? 0) : null,
      ctr: found && found.impressions > 0 ? found.clicks / found.impressions : null,
      averagePosition:
        found && found.impressions > 0 ? found.positionWeighted / found.impressions : null,

      intakeStarts: eventsOn ? (intake.starts.get(path) ?? 0) : null,
      intakeSubmissions: intake.submissions.get(path) ?? 0,
      qualified: intake.qualified.get(path) ?? 0,
      contentReads: eventsOn ? (intake.reads.get(path) ?? 0) : null,
    });
  }

  return rows.sort(
    (a, b) =>
      (b.views ?? 0) - (a.views ?? 0) ||
      (b.clicks ?? 0) - (a.clicks ?? 0) ||
      a.path.localeCompare(b.path),
  );
}

/* --------------------------------------------------------- source grouping */

export interface SourceGroup {
  source: string;
  visits: number;
  submissions: number;
}

/**
 * Traffic grouped by source, with assistant referrers collected under one
 * label. This is a grouping of referrers we can see. It does not claim to
 * measure how often an assistant used or cited the site.
 */
export function sourceGroups(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): SourceGroup[] {
  const tally = new Map<string, SourceGroup>();
  const ensure = (source: string) => {
    const found = tally.get(source) ?? { source, visits: 0, submissions: 0 };
    tally.set(source, found);
    return found;
  };

  for (const event of events) {
    if (event.eventName !== "page_view") continue;
    ensure(labelFor(event.utm?.source, event.referrer)).visits += 1;
  }
  for (const submission of submissions) {
    ensure(
      labelFor(submission.attribution.utm?.source, submission.attribution.entryReferrer),
    ).submissions += 1;
  }

  return [...tally.values()].sort(
    (a, b) => b.visits - a.visits || b.submissions - a.submissions,
  );
}

function labelFor(utmSource: string | null | undefined, referrer: string | null | undefined) {
  const host = referrerHost(referrer);
  if (host && AI_HOSTS.has(host)) return "AI referrals";
  return utmSource?.trim() || host || "Direct";
}

export function isAiReferrer(referrer: string | null | undefined): boolean {
  return AI_HOSTS.has(referrerHost(referrer));
}

/* ------------------------------------------------------------ ai referrals */

const AI_LABELS: Record<string, string> = {
  "chat.openai.com": "ChatGPT",
  "chatgpt.com": "ChatGPT",
  "perplexity.ai": "Perplexity",
  "copilot.microsoft.com": "Microsoft Copilot",
  "gemini.google.com": "Gemini",
  "claude.ai": "Claude",
};

/** The friendly name for a recognised assistant host. */
export function aiReferrerLabel(host: string): string {
  return AI_LABELS[host] ?? host;
}

/**
 * Assistant referrals, broken out by the host we recognised.
 *
 * The honest boundary matters here. We can only see a referrer when the
 * assistant sends one, so this counts arrivals we can attribute, not the times
 * a model read or recommended the site. Everything else stays in the wider
 * source list rather than being folded into a bigger claim.
 */
export function aiReferrals(
  events: WebsiteEvent[],
  submissions: WebsiteSubmission[],
): AiReferralSummary {
  const byHost = new Map<string, AiReferralRow>();
  const ensure = (host: string) => {
    const row = byHost.get(host) ?? {
      host,
      label: aiReferrerLabel(host),
      visits: 0,
      submissions: 0,
    };
    byHost.set(host, row);
    return row;
  };

  let attributableVisits = 0;
  for (const event of events) {
    if (event.eventName !== "page_view") continue;
    const host = referrerHost(event.referrer);
    if (!host) continue;
    attributableVisits += 1;
    if (AI_HOSTS.has(host)) ensure(host).visits += 1;
  }

  for (const submission of submissions) {
    const host = referrerHost(submission.attribution.entryReferrer);
    if (host && AI_HOSTS.has(host)) ensure(host).submissions += 1;
  }

  const rows = [...byHost.values()].sort(
    (a, b) => b.visits - a.visits || b.submissions - a.submissions || a.label.localeCompare(b.label),
  );

  return {
    rows,
    visits: rows.reduce((total, row) => total + row.visits, 0),
    submissions: rows.reduce((total, row) => total + row.submissions, 0),
    attributableVisits,
    unmeasured: events.length === 0,
  };
}
