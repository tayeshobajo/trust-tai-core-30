/**
 * Search demand intelligence.
 *
 * Deterministic and inspectable. Every threshold is a named constant, every
 * conclusion carries the numbers behind it, and nothing here writes content or
 * asks Studio for anything. It reports demand; people decide.
 */

import type {
  CompetingQuery,
  ContentOpportunity,
  QueryRow,
  SearchMetricsDay,
} from "@/domain/website-analytics";

import { normalizePath } from "./url";

/** Below this an impression count is noise, not demand. */
export const MIN_IMPRESSIONS = 50;
/** A CTR under this with real impressions means the result is being skipped. */
export const WEAK_CTR = 0.02;
/** Striking distance: close enough that a better page would move it. */
export const STRIKING_MIN = 4;
export const STRIKING_MAX = 20;
/** Two pages both need this share of a query before it counts as competing. */
export const COMPETING_SHARE = 0.2;
/** Change is only reported when both halves of the window have data. */
export const MIN_HALF_DAYS = 3;

interface Bucket {
  clicks: number;
  impressions: number;
  positionWeighted: number;
  byPath: Map<string, number>;
  dates: Set<string>;
}

function bucket(): Bucket {
  return {
    clicks: 0,
    impressions: 0,
    positionWeighted: 0,
    byPath: new Map(),
    dates: new Set(),
  };
}

function add(target: Bucket, row: SearchMetricsDay) {
  target.clicks += row.clicks;
  target.impressions += row.impressions;
  target.positionWeighted += row.position * row.impressions;
  target.dates.add(row.date);
  const path = normalizePath(row.path);
  target.byPath.set(path, (target.byPath.get(path) ?? 0) + row.impressions);
}

function midpoint(rows: SearchMetricsDay[]): string | null {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  if (dates.length < MIN_HALF_DAYS * 2) return null;
  return dates[Math.floor(dates.length / 2)] ?? null;
}

/** Every query with demand in the window, strongest first. */
export function queryRows(rows: SearchMetricsDay[]): QueryRow[] {
  const split = midpoint(rows);
  const whole = new Map<string, Bucket>();
  const early = new Map<string, number>();
  const late = new Map<string, number>();

  for (const row of rows) {
    const query = row.query.trim().toLowerCase();
    if (!query) continue;
    const found = whole.get(query) ?? bucket();
    add(found, row);
    whole.set(query, found);
    if (split) {
      const target = row.date < split ? early : late;
      target.set(query, (target.get(query) ?? 0) + row.clicks);
    }
  }

  return [...whole.entries()]
    .map(([query, found]) => {
      const topPath =
        [...found.byPath.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return {
        query,
        clicks: found.clicks,
        impressions: found.impressions,
        ctr: found.impressions > 0 ? found.clicks / found.impressions : 0,
        averagePosition:
          found.impressions > 0 ? found.positionWeighted / found.impressions : 0,
        change: split ? (late.get(query) ?? 0) - (early.get(query) ?? 0) : null,
        topPath,
      } satisfies QueryRow;
    })
    .sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions);
}

export function growingQueries(rows: QueryRow[]): QueryRow[] {
  return rows.filter((row) => (row.change ?? 0) > 0).sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
}

export function decliningQueries(rows: QueryRow[]): QueryRow[] {
  return rows.filter((row) => (row.change ?? 0) < 0).sort((a, b) => (a.change ?? 0) - (b.change ?? 0));
}

/** Seen often, clicked rarely. The title and description are the problem. */
export function highImpressionLowCtr(rows: QueryRow[]): QueryRow[] {
  return rows
    .filter((row) => row.impressions >= MIN_IMPRESSIONS && row.ctr < WEAK_CTR)
    .sort((a, b) => b.impressions - a.impressions);
}

/** Positions four to twenty: close enough to be worth a real improvement. */
export function strikingDistance(rows: QueryRow[]): QueryRow[] {
  return rows
    .filter(
      (row) =>
        row.impressions >= MIN_IMPRESSIONS &&
        row.averagePosition >= STRIKING_MIN &&
        row.averagePosition <= STRIKING_MAX,
    )
    .sort((a, b) => a.averagePosition - b.averagePosition);
}

/** Two or more of our own pages showing for the same query. */
export function competingPages(rows: SearchMetricsDay[]): CompetingQuery[] {
  const byQuery = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const query = row.query.trim().toLowerCase();
    if (!query) continue;
    const paths = byQuery.get(query) ?? new Map<string, number>();
    const path = normalizePath(row.path);
    paths.set(path, (paths.get(path) ?? 0) + row.impressions);
    byQuery.set(query, paths);
  }

  const out: CompetingQuery[] = [];
  for (const [query, paths] of byQuery) {
    const total = [...paths.values()].reduce((sum, value) => sum + value, 0);
    if (total < MIN_IMPRESSIONS) continue;
    const meaningful = [...paths.entries()]
      .filter(([, impressions]) => impressions / total >= COMPETING_SHARE)
      .map(([path, impressions]) => ({ path, impressions }))
      .sort((a, b) => b.impressions - a.impressions);
    if (meaningful.length > 1) out.push({ query, paths: meaningful });
  }
  return out.sort((a, b) => (b.paths[0]?.impressions ?? 0) - (a.paths[0]?.impressions ?? 0));
}

/** What people are finding us for, grouped by the leading word of the query. */
export function searchTopics(rows: QueryRow[], limit = 8): { topic: string; impressions: number }[] {
  const tally = new Map<string, number>();
  for (const row of rows) {
    const topic = row.query.split(/\s+/).slice(0, 2).join(" ");
    if (!topic) continue;
    tally.set(topic, (tally.get(topic) ?? 0) + row.impressions);
  }
  return [...tally.entries()]
    .map(([topic, impressions]) => ({ topic, impressions }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, limit);
}

/**
 * Repeated demand with weak coverage. An opportunity is never an instruction
 * to write: when a page already ranks for the demand, the honest move is to
 * refresh that page first.
 */
export function contentOpportunities(
  rows: SearchMetricsDay[],
  knownPaths: string[],
): ContentOpportunity[] {
  const inventory = new Set(knownPaths.map(normalizePath));
  const queries = queryRows(rows);

  return queries
    .filter((row) => row.impressions >= MIN_IMPRESSIONS)
    .map((row) => {
      const covered = row.topPath ? inventory.has(row.topPath) : false;
      const ranksWell = row.averagePosition > 0 && row.averagePosition < STRIKING_MIN;

      if (!row.topPath) {
        return opportunity(row, "none", null, "Real demand with no page of ours attached to it.");
      }
      if (covered && ranksWell && row.ctr >= WEAK_CTR) return null;
      if (covered && row.ctr < WEAK_CTR) {
        return opportunity(
          row,
          "thin",
          row.topPath,
          "A page already shows for this demand but is rarely clicked. Refresh it before writing another one on the topic.",
        );
      }
      if (covered) {
        return opportunity(
          row,
          "existing",
          row.topPath,
          "A page covers this demand but sits outside the first results.",
        );
      }
      return opportunity(
        row,
        "none",
        null,
        "Demand is landing on a page Core does not hold in the inventory.",
      );
    })
    .filter((row): row is ContentOpportunity => row !== null)
    .sort((a, b) => b.impressions - a.impressions);
}

function opportunity(
  row: QueryRow,
  coverage: ContentOpportunity["coverage"],
  refreshPath: string | null,
  reason: string,
): ContentOpportunity {
  return {
    query: row.query,
    impressions: row.impressions,
    averagePosition: row.averagePosition,
    ctr: row.ctr,
    coverage,
    refreshPath,
    reason,
  };
}
