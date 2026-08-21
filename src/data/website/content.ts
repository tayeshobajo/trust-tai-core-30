/**
 * Published content performance, and content decay.
 *
 * This is measurement after publishing, not an editor. Studio creates and
 * approves; the Website room reports what happened next. Every label below is
 * a rule with named thresholds, never a score.
 */

import type {
  ContentClassification,
  ContentRow,
  PageMetricsDay,
  PageRow,
  SearchMetricsDay,
  WebsitePage,
} from "@/domain/website-analytics";
import { EMPTY_CONTENT_INTENT } from "@/domain/website-analytics";

import { normalizePath } from "./url";

export const CONTENT_TYPES = new Set(["blog", "case_study"]);

/** Below these a difference is noise. */
export const MIN_VIEWS_FOR_LABEL = 50;
export const MIN_IMPRESSIONS_FOR_LABEL = 100;
/** Growth that counts as a breakout. */
export const BREAKOUT_GROWTH = 0.5;
/** A sleeping asset ranks but is barely read. */
export const SLEEPING_CTR = 0.015;
/** Traffic loss that counts as decay. */
export const DECAY_DROP = 0.3;
/** Decay is only claimed once a piece has had time to settle. */
export const DECAY_MIN_AGE_DAYS = 90;

interface Halves {
  early: number;
  late: number;
  usable: boolean;
}

function splitDate(dates: string[]): string | null {
  const unique = [...new Set(dates)].sort();
  if (unique.length < 6) return null;
  return unique[Math.floor(unique.length / 2)];
}

function halves(rows: { date: string; value: number }[], split: string | null): Halves {
  if (!split) return { early: 0, late: 0, usable: false };
  let early = 0;
  let late = 0;
  for (const row of rows) {
    if (row.date < split) early += row.value;
    else late += row.value;
  }
  return { early, late, usable: true };
}

function ageDays(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

export interface ContentInput {
  pageRows: PageRow[];
  pages: WebsitePage[];
  pageMetrics: PageMetricsDay[];
  searchMetrics: SearchMetricsDay[];
  now?: Date;
}

/**
 * Content rows with deterministic labels. A page with no label is not a
 * failure; it means no rule was true with enough evidence to say so.
 */
export function buildContentRows(input: ContentInput): ContentRow[] {
  const now = input.now ?? new Date();
  const inventory = new Map(input.pages.map((page) => [normalizePath(page.path), page]));

  const viewsByPath = new Map<string, { date: string; value: number }[]>();
  for (const row of input.pageMetrics) {
    const path = normalizePath(row.path);
    const list = viewsByPath.get(path) ?? [];
    list.push({ date: row.date, value: row.views });
    viewsByPath.set(path, list);
  }
  const impressionsByPath = new Map<string, { date: string; value: number }[]>();
  for (const row of input.searchMetrics) {
    const path = normalizePath(row.path);
    const list = impressionsByPath.get(path) ?? [];
    list.push({ date: row.date, value: row.impressions });
    impressionsByPath.set(path, list);
  }

  const split = splitDate([
    ...input.pageMetrics.map((row) => row.date),
    ...input.searchMetrics.map((row) => row.date),
  ]);

  const conversionRates = input.pageRows
    .map((row) =>
      row.views && row.views >= MIN_VIEWS_FOR_LABEL && row.intakeSubmissions !== null
        ? row.intakeSubmissions / row.views
        : null,
    )
    .filter((value): value is number => value !== null && value > 0)
    .sort((a, b) => a - b);
  const medianConversion =
    conversionRates.length > 0 ? conversionRates[Math.floor(conversionRates.length / 2)] : null;

  return input.pageRows
    .filter((row) => CONTENT_TYPES.has(row.pageType))
    .map((row) => {
      const page = inventory.get(row.path);
      const classifications: ContentClassification[] = [];
      const reasons: string[] = [];

      const viewHalves = halves(viewsByPath.get(row.path) ?? [], split);
      const impressionHalves = halves(impressionsByPath.get(row.path) ?? [], split);
      const age = ageDays(page?.lastUpdatedAt ?? page?.publishedAt ?? null, now);

      if (
        viewHalves.usable &&
        viewHalves.early >= MIN_VIEWS_FOR_LABEL &&
        viewHalves.late > viewHalves.early * (1 + BREAKOUT_GROWTH)
      ) {
        classifications.push("breakout");
        reasons.push(
          `Views rose from ${viewHalves.early} to ${viewHalves.late} across the two halves of the window.`,
        );
      }

      if (
        row.impressions !== null &&
        row.impressions >= MIN_IMPRESSIONS_FOR_LABEL &&
        row.ctr !== null &&
        row.ctr < SLEEPING_CTR
      ) {
        classifications.push("sleeping_asset");
        reasons.push(
          `Seen ${row.impressions} times in search with a click through rate of ${(row.ctr * 100).toFixed(1)} percent.`,
        );
      }

      const decayed =
        viewHalves.usable &&
        viewHalves.early >= MIN_VIEWS_FOR_LABEL &&
        viewHalves.late < viewHalves.early * (1 - DECAY_DROP) &&
        impressionHalves.usable &&
        impressionHalves.late >= impressionHalves.early * (1 - DECAY_DROP) &&
        age !== null &&
        age >= DECAY_MIN_AGE_DAYS;

      if (decayed) {
        classifications.push("needs_refresh");
        reasons.push(
          `Search interest held steady while visits fell from ${viewHalves.early} to ${viewHalves.late}, and the piece was last updated ${age} days ago. Refresh this before writing another one on the same topic.`,
        );
      }

      if (
        medianConversion !== null &&
        row.views !== null &&
        row.views >= MIN_VIEWS_FOR_LABEL &&
        row.intakeSubmissions !== null &&
        row.intakeSubmissions > 0 &&
        row.intakeSubmissions / row.views > medianConversion
      ) {
        classifications.push("conversion_winner");
        reasons.push(
          `${row.intakeSubmissions} conversations came from ${row.views} visits, above the median for published content.`,
        );
      }

      return {
        ...row,
        topic: page?.topic ?? page?.intent.topic ?? null,
        intent: page?.intent ?? EMPTY_CONTENT_INTENT,
        classifications,
        reasons,
      } satisfies ContentRow;
    })
    .sort(
      (a, b) =>
        b.classifications.length - a.classifications.length ||
        (b.views ?? 0) - (a.views ?? 0) ||
        a.path.localeCompare(b.path),
    );
}

/** The content that is decaying, in the order it should be looked at. */
export function decayingContent(rows: ContentRow[]): ContentRow[] {
  return rows.filter((row) => row.classifications.includes("needs_refresh"));
}

export const CLASSIFICATION_LABELS: Record<ContentClassification, string> = {
  breakout: "Breakout",
  sleeping_asset: "Sleeping asset",
  needs_refresh: "Needs refresh",
  conversion_winner: "Conversion winner",
};
