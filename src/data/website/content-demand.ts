/**
 * Content demand, folded once from what the Website room already observes.
 *
 * Pure and deterministic. It invents no threshold: every rule here is the one
 * already written in `search.ts`, reused rather than restated. Its whole job is
 * to gather, per query, the observed facts plus the provenance a person needs
 * to judge them: the window the numbers came from, how many days actually
 * carried data, which of our own pages compete for the phrase, and what the
 * inventory says about the page the demand lands on.
 *
 * Three honesty rules hold throughout:
 *
 *  - Unknown is not zero. A metric that was never reported is `null`, and a
 *    window with no rows is `read: false`, not "no demand".
 *  - Thin data says so. Search Console coverage in this deployment is sparse,
 *    so every signal carries `thin` and the reason it is thin, and callers are
 *    expected to show that rather than dress three rows up as a trend.
 *  - Nothing here decides anything. No writes, no model, no content.
 */

import type {
  CompetingQuery,
  QueryRow,
  SearchMetricsDay,
  WebsitePage,
} from "@/domain/website-analytics";

import {
  MIN_HALF_DAYS,
  MIN_IMPRESSIONS,
  STRIKING_MAX,
  STRIKING_MIN,
  WEAK_CTR,
  competingPages,
  queryRows,
} from "./search";
import { normalizePath } from "./url";

/** The observed window behind a set of signals. */
export interface DemandWindow {
  /** False when the provider returned nothing at all for this window. */
  read: boolean;
  start: string | null;
  end: string | null;
  /** Distinct dates that actually carried a row. */
  daysWithData: number;
  rowCount: number;
}

/** Where a landing path stands in the canonical inventory. */
export interface DemandCoverage {
  path: string | null;
  /** null when there is no path to judge, so unknown stays unknown. */
  inInventory: boolean | null;
  title: string | null;
  pageType: string | null;
}

export interface ContentDemandSignal {
  /** The observed phrase, lower cased exactly as `queryRows` normalizes it. */
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  averagePosition: number;
  /** Null when the window is too short to compare halves honestly. */
  change: number | null;
  coverage: DemandCoverage;
  /** Our own pages sharing this phrase, from `competingPages`. */
  competing: { path: string; impressions: number }[];
  /** Above `MIN_IMPRESSIONS`, the existing noise floor. */
  meetsDemandFloor: boolean;
  /** Seen often, rarely clicked. `WEAK_CTR`. */
  weakCtr: boolean;
  /** Positions `STRIKING_MIN`..`STRIKING_MAX` with real impressions. */
  strikingDistance: boolean;
  /** True when this signal rests on too little data to lean on. */
  thin: boolean;
  /** Plain reason a signal is thin. Empty when it is not. */
  thinBecause: string[];
  window: DemandWindow;
}

export interface ContentDemandReading {
  window: DemandWindow;
  signals: ContentDemandSignal[];
  /** True when the whole reading is too sparse to support a conclusion. */
  thin: boolean;
  /** Plain sentences a surface can show verbatim. Never invented numbers. */
  because: string[];
  /** Named gaps. Silence is an answer; it is never a zero. */
  unknowns: string[];
}

export interface ContentDemandInput {
  searchMetrics: SearchMetricsDay[];
  /** Canonical page inventory, when it has been read. */
  pages?: WebsitePage[];
  /** False when the inventory could not be read at all. */
  inventoryRead?: boolean;
  /** False when the search provider has never run or could not be read. */
  searchRead?: boolean;
}

/** A reading needs at least this many dated rows before halves mean anything. */
export const MIN_WINDOW_DAYS = MIN_HALF_DAYS * 2;

function windowOf(rows: SearchMetricsDay[], read: boolean): DemandWindow {
  const dates = [...new Set(rows.map((row) => row.date))].sort();
  return {
    read,
    start: dates[0] ?? null,
    end: dates[dates.length - 1] ?? null,
    daysWithData: dates.length,
    rowCount: rows.length,
  };
}

function coverageOf(
  row: QueryRow,
  inventory: Map<string, WebsitePage>,
  inventoryRead: boolean,
): DemandCoverage {
  const path = row.topPath ? normalizePath(row.topPath) : null;
  if (!path) return { path: null, inInventory: null, title: null, pageType: null };
  if (!inventoryRead) return { path, inInventory: null, title: null, pageType: null };
  const page = inventory.get(path);
  return {
    path,
    inInventory: Boolean(page),
    title: page?.title ?? null,
    pageType: page?.pageType ?? null,
  };
}

/**
 * Fold observed search rows into per-query demand signals.
 *
 * Signals are returned for every query in the window, including ones below the
 * demand floor: filtering is a judgment, and this function reports. `thin`
 * carries that judgment forward without hiding the row.
 */
export function readContentDemand(input: ContentDemandInput): ContentDemandReading {
  const searchRead = input.searchRead ?? true;
  const inventoryRead = input.inventoryRead ?? Boolean(input.pages);
  const rows = input.searchMetrics ?? [];
  const window = windowOf(rows, searchRead && rows.length > 0);

  const unknowns: string[] = [];
  const because: string[] = [];

  if (!searchRead) {
    unknowns.push("Search Console has not been read, so demand is unknown, not zero.");
    return { window, signals: [], thin: true, because: [...unknowns], unknowns };
  }
  if (rows.length === 0) {
    unknowns.push("No search rows were returned for this window, so demand is unknown.");
    return { window, signals: [], thin: true, because: [...unknowns], unknowns };
  }
  if (!inventoryRead) {
    unknowns.push("The page inventory has not been read, so page coverage is unknown.");
  }

  const inventory = new Map<string, WebsitePage>(
    (input.pages ?? []).map((page) => [normalizePath(page.path), page]),
  );
  const competing = new Map<string, CompetingQuery["paths"]>(
    competingPages(rows).map((entry) => [entry.query, entry.paths]),
  );

  const shortWindow = window.daysWithData < MIN_WINDOW_DAYS;
  if (shortWindow) {
    because.push(
      `Only ${window.daysWithData} day${window.daysWithData === 1 ? "" : "s"} of search data is present, so change over time cannot be read.`,
    );
  }

  const signals = queryRows(rows).map((row) => {
    const meetsDemandFloor = row.impressions >= MIN_IMPRESSIONS;
    const thinBecause: string[] = [];
    if (!meetsDemandFloor) {
      thinBecause.push(
        `${row.impressions} impression${row.impressions === 1 ? "" : "s"} is below the ${MIN_IMPRESSIONS} the room treats as demand.`,
      );
    }
    if (shortWindow)
      thinBecause.push("The window is too short to compare one half with the other.");

    return {
      query: row.query,
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: row.ctr,
      averagePosition: row.averagePosition,
      change: row.change,
      coverage: coverageOf(row, inventory, inventoryRead),
      competing: competing.get(row.query) ?? [],
      meetsDemandFloor,
      weakCtr: meetsDemandFloor && row.ctr < WEAK_CTR,
      strikingDistance:
        meetsDemandFloor &&
        row.averagePosition >= STRIKING_MIN &&
        row.averagePosition <= STRIKING_MAX,
      thin: thinBecause.length > 0,
      thinBecause,
      window,
    } satisfies ContentDemandSignal;
  });

  const solid = signals.filter((signal) => !signal.thin);
  const thin = solid.length === 0;
  if (thin && signals.length > 0) {
    because.push("No query in this window clears the demand floor, so nothing here is a trend.");
  }

  return { window, signals, thin, because, unknowns };
}

/** The signals a person could reasonably act on: demand floor met, not thin. */
export function actionableDemand(reading: ContentDemandReading): ContentDemandSignal[] {
  return reading.signals.filter((signal) => !signal.thin);
}
