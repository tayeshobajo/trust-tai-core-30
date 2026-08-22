/**
 * The Overview lanes: what is working, what needs attention, and the next move.
 *
 * Read only and deterministic. When there is not enough evidence a lane says so
 * plainly rather than inventing an insight. Conductor remains the governed
 * recommendation layer; these are observations a person can act on.
 */

import type {
  ContentRow,
  HealthFinding,
  PageRow,
  ProviderReadiness,
  ProviderState,
  QueryRow,
  WebsiteObservation,
} from "@/domain/website-analytics";
import type { KnownNumber, WebsiteSubmission } from "@/domain/website";

import { isQualified } from "./projection";
import { isOperationalPath } from "./url";

export interface OverviewMetric {
  key: string;
  label: string;
  value: KnownNumber;
  note: string;
}

export interface OverviewInput {
  pageRows: PageRow[];
  contentRows: ContentRow[];
  queries: QueryRow[];
  health: HealthFinding[];
  submissions: WebsiteSubmission[];
  readiness: ProviderReadiness[];
  windowDays: number;
}

const sum = (values: KnownNumber[]): KnownNumber => {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
};

/** The state a provider is in, falling back to what was observed. */
export function stateOf(
  readiness: ProviderReadiness[],
  id: string,
): ProviderState | "unknown" {
  const entry = readiness.find((row) => row.id === id);
  if (!entry) return "unknown";
  return entry.state ?? (entry.connected ? "live" : "not_configured");
}

/** A successful sync counts as measured, even when it returned no rows. */
export function isMeasured(state: ProviderState | "unknown"): boolean {
  return state === "live" || state === "quiet" || state === "stale";
}

/** Pages a person would recognise as ours. Errors and back office are not. */
export function isPublicContentRow(row: PageRow): boolean {
  return !isOperationalPath(row.path) && !row.unlisted;
}

export function overviewMetrics(input: OverviewInput): OverviewMetric[] {
  const ga = stateOf(input.readiness, "ga4");
  const gsc = stateOf(input.readiness, "search_console");
  const gaOn = isMeasured(ga);
  const gscOn = isMeasured(gsc);

  return [
    {
      key: "visitors",
      label: "Visitors",
      value: gaOn ? (sum(input.pageRows.map((row) => row.users)) ?? 0) : null,
      note: gaOn ? `Last ${input.windowDays} days` : "GA4 is not reporting yet",
    },
    {
      key: "clicks",
      label: "Search clicks",
      value: gscOn ? (sum(input.pageRows.map((row) => row.clicks)) ?? 0) : null,
      note: gscOn
        ? gsc === "quiet"
          ? "Connected, no rows returned yet"
          : `Last ${input.windowDays} days`
        : "Search Console is not reporting yet",
    },
    {
      key: "conversations",
      label: "Intake conversations",
      value: input.submissions.length,
      note: "Completed founder conversations",
    },
    {
      key: "qualified",
      label: "Qualified in Scout",
      value: input.submissions.filter((row) => isQualified(row.scoutStatus)).length,
      note: "Scout owns this decision",
    },
    {
      key: "impressions",
      label: "Search impressions",
      value: gscOn ? (sum(input.pageRows.map((row) => row.impressions)) ?? 0) : null,
      note: gscOn ? "How often we were seen" : "Search Console is not reporting yet",
    },
  ];
}

export function overviewObservations(input: OverviewInput): WebsiteObservation[] {
  const out: WebsiteObservation[] = [];
  const gaOn = isMeasured(stateOf(input.readiness, "ga4"));
  const gscOn = isMeasured(stateOf(input.readiness, "search_console"));

  /* ------------------------------------------------------------- working */

  const entryPoints = input.pageRows
    .filter((row) => isPublicContentRow(row) && row.path !== "/" && (row.landingSessions ?? 0) > 0)
    .sort((a, b) => (b.landingSessions ?? 0) - (a.landingSessions ?? 0));
  const best = entryPoints[0];
  if (best) {
    out.push({
      id: "strongest-entry",
      lane: "working",
      statement: `The ${best.title} page is the strongest entry point outside the homepage.`,
      evidence: [`${best.landingSessions} landing sessions on ${best.path}.`],
    });
  }

  const winners = input.contentRows.filter(
    (row) => isPublicContentRow(row) && row.classifications.includes("conversion_winner"),
  );
  for (const row of winners.slice(0, 2)) {
    out.push({
      id: `winner-${row.path}`,
      lane: "working",
      statement: `${row.title} brings fewer visits than the top pages but more qualified conversations.`,
      evidence: row.reasons,
    });
  }

  const qualified = input.submissions.filter((row) => isQualified(row.scoutStatus));
  if (out.length === 0 && qualified.length > 0) {
    out.push({
      id: "intake-working",
      lane: "working",
      statement: `The intake conversation is doing its job. ${qualified.length} of ${input.submissions.length} conversations reached qualified in Scout.`,
      evidence: qualified
        .slice(0, 4)
        .map((row) => row.company.name || row.person.name || row.submissionId),
    });
  }

  /* ----------------------------------------------------------- attention */

  const missingPages = input.pageRows
    .filter((row) => row.unlisted && (row.views ?? 0) > 0)
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
  if (missingPages.length > 0) {
    out.push({
      id: "landing-on-missing",
      lane: "attention",
      statement:
        missingPages.length === 1
          ? "Visitors are landing on an address the site does not publish."
          : `Visitors are landing on ${missingPages.length} addresses the site does not publish.`,
      evidence: [
        "These paths are not in the page inventory, so they most likely return a missing page.",
        ...missingPages.slice(0, 5).map((row) => `${row.path}: ${row.views} views.`),
      ],
    });
  }

  const sleeping = input.contentRows.filter(
    (row) => isPublicContentRow(row) && row.classifications.includes("sleeping_asset"),
  );
  if (sleeping.length > 0) {
    out.push({
      id: "sleeping",
      lane: "attention",
      statement:
        sleeping.length === 1
          ? "One article is seen often in search and rarely clicked."
          : `${sleeping.length} articles have high impressions and low click through.`,
      evidence: sleeping.slice(0, 4).map((row) => `${row.path}: ${row.reasons[0] ?? ""}`.trim()),
    });
  }

  for (const finding of input.health.filter((entry) => entry.severity === "attention")) {
    out.push({
      id: `health-${finding.id}`,
      lane: "attention",
      statement: finding.title,
      evidence: [finding.detail, ...finding.paths.slice(0, 5)],
    });
  }

  /* ----------------------------------------------------------- next move */

  const refresh = input.contentRows.filter(
    (row) => isPublicContentRow(row) && row.classifications.includes("needs_refresh"),
  );
  const stale = refresh[0];
  if (stale) {
    out.push({
      id: "refresh-first",
      lane: "next_move",
      statement: `Refresh ${stale.title} before creating another post on the same topic.`,
      evidence: stale.reasons,
    });
  }

  const unlinked = input.submissions.filter((row) => row.linkState === "unlinked");
  if (unlinked.length > 0) {
    out.push({
      id: "unlinked-intake",
      lane: "next_move",
      statement: `${unlinked.length} founder ${unlinked.length === 1 ? "conversation is" : "conversations are"} waiting for a person to place them in Scout.`,
      evidence: unlinked
        .slice(0, 4)
        .map((row) => row.company.name || row.person.name || row.submissionId),
    });
  }

  if (refresh.length === 0 && unlinked.length === 0 && sleeping.length > 0) {
    out.push({
      id: "titles-first",
      lane: "next_move",
      statement: "Rewrite the titles and descriptions on the pages that are seen and skipped.",
      evidence: sleeping.slice(0, 4).map((row) => row.path),
    });
  }

  /* A baseline is the honest next move while the record is still thin. */
  if (!out.some((entry) => entry.lane === "next_move")) {
    out.push({
      id: "baseline",
      lane: "next_move",
      statement: "Keep collecting a clean baseline before changing anything.",
      evidence: baselineGaps(input, gaOn, gscOn),
    });
  }

  return out;
}

function baselineGaps(input: OverviewInput, gaOn: boolean, gscOn: boolean): string[] {
  const gaps: string[] = [];
  const views = sum(input.pageRows.map((row) => row.views));

  if (!gaOn) gaps.push("GA4 has not returned page metrics for this window.");
  else if ((views ?? 0) < 25)
    gaps.push(
      `Only ${views ?? 0} measured page views in the last ${input.windowDays} days, which is too thin to read a trend.`,
    );

  if (!gscOn) gaps.push("Search Console has not returned performance rows for this window.");
  else if (input.queries.length === 0)
    gaps.push("Search Console is connected and has returned no query rows for this window yet.");

  const events = input.readiness.find((entry) => entry.id === "first_party_events");
  if (events && (events.state === "quiet" || !events.connected))
    gaps.push("No first party site events have arrived, so source mix and intake starts are blank.");

  if (gaps.length === 0) gaps.push("Two comparable periods are needed before a change can be read.");
  return gaps;
}

/** What to say when a lane has nothing grounded in it. */
export function laneFallback(
  lane: WebsiteObservation["lane"],
  readiness: ProviderReadiness[],
): string {
  const missing = readiness
    .filter((entry) => !isMeasured(entry.state ?? (entry.connected ? "live" : "not_configured")))
    .map((entry) => entry.label);
  const because =
    missing.length > 0
      ? ` ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not reporting yet.`
      : "";
  switch (lane) {
    case "working":
      return `Not enough measured traffic yet to say what is working.${because}`;
    case "changing":
      return `No change can be read without at least two comparable periods of data.${because}`;
    case "attention":
      return "Nothing about the public site is visibly working against us.";
    case "next_move":
      return `No move is grounded enough to recommend yet.${because}`;
  }
}
