/**
 * The Overview lanes: what is working, what is changing, what needs attention,
 * and the next move.
 *
 * Read only and deterministic. When there is not enough evidence a lane says
 * so plainly rather than inventing an insight. Conductor remains the governed
 * recommendation layer; these are observations a person can act on.
 */

import type {
  ContentRow,
  HealthFinding,
  PageRow,
  ProviderReadiness,
  QueryRow,
  WebsiteObservation,
} from "@/domain/website-analytics";
import type { KnownNumber, WebsiteSubmission } from "@/domain/website";

import { isQualified } from "./projection";

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

export function overviewMetrics(input: OverviewInput): OverviewMetric[] {
  const ga = input.readiness.find((entry) => entry.id === "ga4")?.connected ?? false;
  const gsc = input.readiness.find((entry) => entry.id === "search_console")?.connected ?? false;

  return [
    {
      key: "visitors",
      label: "Visitors",
      value: ga ? sum(input.pageRows.map((row) => row.users)) : null,
      note: ga ? `Last ${input.windowDays} days` : "Waiting on GA4",
    },
    {
      key: "clicks",
      label: "Search clicks",
      value: gsc ? sum(input.pageRows.map((row) => row.clicks)) : null,
      note: gsc ? `Last ${input.windowDays} days` : "Waiting on Search Console",
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
      value: gsc ? sum(input.pageRows.map((row) => row.impressions)) : null,
      note: gsc ? "How often we were seen" : "Waiting on Search Console",
    },
  ];
}

export function overviewObservations(input: OverviewInput): WebsiteObservation[] {
  const out: WebsiteObservation[] = [];

  /* ------------------------------------------------------------- working */

  const entryPoints = input.pageRows
    .filter((row) => row.path !== "/" && (row.landingSessions ?? 0) > 0)
    .sort((a, b) => (b.landingSessions ?? 0) - (a.landingSessions ?? 0));
  if (entryPoints.length > 0) {
    const best = entryPoints[0];
    out.push({
      id: "strongest-entry",
      lane: "working",
      statement: `The ${best.title} page is the strongest entry point outside the homepage.`,
      evidence: [`${best.landingSessions} landing sessions on ${best.path}.`],
    });
  }

  const winners = input.contentRows.filter((row) =>
    row.classifications.includes("conversion_winner"),
  );
  for (const row of winners.slice(0, 2)) {
    out.push({
      id: `winner-${row.path}`,
      lane: "working",
      statement: `${row.title} brings fewer visits than the top pages but more qualified conversations.`,
      evidence: row.reasons,
    });
  }

  /* ------------------------------------------------------------ changing */

  const breakouts = input.contentRows.filter((row) => row.classifications.includes("breakout"));
  for (const row of breakouts.slice(0, 2)) {
    out.push({
      id: `breakout-${row.path}`,
      lane: "changing",
      statement: `${row.title} is being read far more than it was earlier in the window.`,
      evidence: row.reasons,
    });
  }

  const growing = input.queries
    .filter((row) => (row.change ?? 0) > 0)
    .sort((a, b) => (b.change ?? 0) - (a.change ?? 0));
  if (growing.length > 0) {
    out.push({
      id: "growing-demand",
      lane: "changing",
      statement: `Search demand is growing around ${growing[0].query}.`,
      evidence: [
        `${growing[0].clicks} clicks from ${growing[0].impressions} impressions, up ${growing[0].change} on the earlier half of the window.`,
      ],
    });
  }

  /* ----------------------------------------------------------- attention */

  const sleeping = input.contentRows.filter((row) =>
    row.classifications.includes("sleeping_asset"),
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

  const refresh = input.contentRows.filter((row) => row.classifications.includes("needs_refresh"));
  if (refresh.length > 0) {
    out.push({
      id: "refresh-first",
      lane: "next_move",
      statement: `Refresh ${refresh[0].title} before creating another post on the same topic.`,
      evidence: refresh[0].reasons,
    });
  }

  const unlinked = input.submissions.filter((row) => row.linkState === "unlinked");
  if (unlinked.length > 0) {
    out.push({
      id: "unlinked-intake",
      lane: "next_move",
      statement: `${unlinked.length} founder ${unlinked.length === 1 ? "conversation is" : "conversations are"} waiting for a person to place them in Scout.`,
      evidence: unlinked.slice(0, 4).map((row) => row.company.name || row.person.name || row.submissionId),
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

  return out;
}

/** What to say when a lane has nothing grounded in it. */
export function laneFallback(lane: WebsiteObservation["lane"], readiness: ProviderReadiness[]): string {
  const missing = readiness.filter((entry) => !entry.connected).map((entry) => entry.label);
  const because =
    missing.length > 0
      ? ` ${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} not connected yet.`
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
