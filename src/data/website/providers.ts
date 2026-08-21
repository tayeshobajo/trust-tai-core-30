/**
 * Provider adapters, pure.
 *
 * GA4 and Search Console are two possible producers of shapes the room already
 * understands. Their responses arrive here and leave as provider neutral rows,
 * keyed exactly the way the tables are keyed, so a retry rewrites a row instead
 * of adding to it. Nothing in this file talks to a network or to a database.
 */

import { normalizePath } from "./url";

/* ------------------------------------------------------------------- shared */

export interface ProviderRunReport {
  dimensionHeaders?: { name?: string }[];
  metricHeaders?: { name?: string }[];
  rows?: {
    dimensionValues?: { value?: string }[];
    metricValues?: { value?: string }[];
  }[];
}

const number = (value: string | undefined): number => {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
};

const round = (value: number): number => Math.round(value * 100) / 100;

/** GA4 reports a date as YYYYMMDD. Everything downstream wants YYYY-MM-DD. */
export function ga4Date(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (/^\d{8}$/.test(raw)) return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return null;
}

const clean = (value: string | undefined): string | null => {
  const raw = (value ?? "").trim();
  if (!raw || raw === "(not set)" || raw === "(other)") return null;
  return raw;
};

/* ---------------------------------------------------------------- GA4 rows */

export const GA4_DIMENSIONS = [
  "date",
  "pagePath",
  "pageTitle",
  "sessionSource",
  "sessionMedium",
  "deviceCategory",
  "country",
] as const;

export const GA4_METRICS = [
  "screenPageViews",
  "totalUsers",
  "sessions",
  "engagedSessions",
  "userEngagementDuration",
] as const;

export interface PageMetricRow {
  organization_id: string;
  provider: string;
  metric_date: string;
  path: string;
  title: string | null;
  views: number;
  users: number;
  landing_sessions: number;
  engaged_sessions: number;
  average_engagement_seconds: number;
  source: string | null;
  medium: string | null;
  device: string | null;
  country: string | null;
}

const pageKey = (row: PageMetricRow): string =>
  [
    row.organization_id,
    row.provider,
    row.metric_date,
    row.path,
    row.source ?? "",
    row.medium ?? "",
    row.device ?? "",
    row.country ?? "",
  ].join("|");

/**
 * Maps a GA4 runReport response onto page metric rows. Rows that repeat a key
 * inside one response are merged once, so a single request can never be
 * counted twice and a retry writes the same values again.
 */
export function ga4PageRows(
  report: ProviderRunReport,
  organizationId: string,
  provider = "ga4",
): PageMetricRow[] {
  const dims = (report.dimensionHeaders ?? []).map((header) => header.name ?? "");
  const metrics = (report.metricHeaders ?? []).map((header) => header.name ?? "");
  const at = (values: { value?: string }[] | undefined, name: string, names: string[]) => {
    const index = names.indexOf(name);
    return index < 0 ? undefined : values?.[index]?.value;
  };

  const merged = new Map<string, PageMetricRow>();
  for (const raw of report.rows ?? []) {
    const date = ga4Date(at(raw.dimensionValues, "date", dims));
    const path = normalizePath(at(raw.dimensionValues, "pagePath", dims) ?? "");
    if (!date) continue;

    const users = number(at(raw.metricValues, "totalUsers", metrics));
    const engagementSeconds = number(at(raw.metricValues, "userEngagementDuration", metrics));

    const row: PageMetricRow = {
      organization_id: organizationId,
      provider,
      metric_date: date,
      path,
      title: clean(at(raw.dimensionValues, "pageTitle", dims)),
      views: number(at(raw.metricValues, "screenPageViews", metrics)),
      users,
      landing_sessions: number(at(raw.metricValues, "sessions", metrics)),
      engaged_sessions: number(at(raw.metricValues, "engagedSessions", metrics)),
      average_engagement_seconds: users > 0 ? round(engagementSeconds / users) : 0,
      source: clean(at(raw.dimensionValues, "sessionSource", dims)),
      medium: clean(at(raw.dimensionValues, "sessionMedium", dims)),
      device: clean(at(raw.dimensionValues, "deviceCategory", dims)),
      country: clean(at(raw.dimensionValues, "country", dims)),
    };

    const key = pageKey(row);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    const totalUsers = existing.users + row.users;
    merged.set(key, {
      ...existing,
      views: existing.views + row.views,
      users: totalUsers,
      landing_sessions: existing.landing_sessions + row.landing_sessions,
      engaged_sessions: existing.engaged_sessions + row.engaged_sessions,
      average_engagement_seconds:
        totalUsers > 0
          ? round(
              (existing.average_engagement_seconds * existing.users +
                row.average_engagement_seconds * row.users) /
                totalUsers,
            )
          : 0,
      title: existing.title ?? row.title,
    });
  }
  return [...merged.values()];
}

/* ------------------------------------------------------- Search Console rows */

export const SEARCH_DIMENSIONS = ["date", "query", "page", "device", "country"] as const;

export interface SearchApiRow {
  keys?: string[];
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
}

export interface SearchMetricRow {
  organization_id: string;
  provider: string;
  metric_date: string;
  query: string;
  path: string;
  clicks: number;
  impressions: number;
  average_position: number;
  device: string | null;
  country: string | null;
}

const searchKey = (row: SearchMetricRow): string =>
  [
    row.organization_id,
    row.provider,
    row.metric_date,
    row.query,
    row.path,
    row.device ?? "",
    row.country ?? "",
  ].join("|");

/**
 * Maps a Search Console searchAnalytics response onto search metric rows.
 * Every address passes through the shared normalizer first, because the room
 * joins on path and Search Console reports full URLs. CTR is not stored: the
 * room derives it from clicks and impressions.
 */
export function searchConsoleRows(
  rows: SearchApiRow[],
  organizationId: string,
  dimensions: readonly string[] = SEARCH_DIMENSIONS,
  provider = "search_console",
): SearchMetricRow[] {
  const merged = new Map<string, SearchMetricRow>();
  const at = (keys: string[] | undefined, name: string) => {
    const index = dimensions.indexOf(name);
    return index < 0 ? undefined : keys?.[index];
  };

  for (const raw of rows) {
    const date = (at(raw.keys, "date") ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const query = (at(raw.keys, "query") ?? "").trim();
    if (!query) continue;

    const row: SearchMetricRow = {
      organization_id: organizationId,
      provider,
      metric_date: date,
      query: query.toLowerCase(),
      path: normalizePath(at(raw.keys, "page") ?? ""),
      clicks: Math.max(0, Math.round(raw.clicks ?? 0)),
      impressions: Math.max(0, Math.round(raw.impressions ?? 0)),
      average_position: round(raw.position ?? 0),
      device: clean(at(raw.keys, "device"))?.toLowerCase() ?? null,
      country: clean(at(raw.keys, "country"))?.toLowerCase() ?? null,
    };

    const key = searchKey(row);
    const existing = merged.get(key);
    if (!existing) {
      merged.set(key, row);
      continue;
    }
    const impressions = existing.impressions + row.impressions;
    merged.set(key, {
      ...existing,
      clicks: existing.clicks + row.clicks,
      impressions,
      average_position:
        impressions > 0
          ? round(
              (existing.average_position * existing.impressions +
                row.average_position * row.impressions) /
                impressions,
            )
          : existing.average_position,
    });
  }
  return [...merged.values()];
}

/* -------------------------------------------------------------- date ranges */

/** A bounded, inclusive list of YYYY-MM-DD days ending yesterday. */
export function backfillRange(days: number, today = new Date()): { start: string; end: string } {
  const bounded = Math.max(1, Math.min(Math.round(days), 400));
  const end = new Date(today.getTime() - 24 * 60 * 60 * 1000);
  const start = new Date(end.getTime() - (bounded - 1) * 24 * 60 * 60 * 1000);
  const iso = (value: Date) => value.toISOString().slice(0, 10);
  return { start: iso(start), end: iso(end) };
}
