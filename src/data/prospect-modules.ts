/**
 * Scout — adaptive composition for the prospect workspace.
 *
 * Pure functions only. Given what is stored for a company, decide which
 * surfaces are worth showing, what changed since last time, and the single
 * next move. No rendering, no Supabase, no side effects.
 */

import type {
  NextMove,
  ProspectComposition,
  ProspectModule,
  ResearchCoverage,
  ResearchRun,
  SignalPulse,
  UnknownNote,
} from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";
import type { ScoutFitEvaluation } from "@/domain/scout-fit";

/** Page kinds the v4 research function reports on. */
const PAGE_KINDS: { key: string; label: string }[] = [
  { key: "offer_page_checked", label: "Offer" },
  { key: "proof_page_checked", label: "Proof" },
  { key: "team_page_checked", label: "Team" },
  { key: "contact_page_checked", label: "Contact" },
];

const STALE_AFTER_DAYS = 30;

/* ------------------------------------------------------------------ *
 * Research history — stored in `prospects.metadata.research_history`
 * ------------------------------------------------------------------ */

function isRun(value: unknown): value is ResearchRun {
  if (!value || typeof value !== "object") return false;
  const run = value as Partial<ResearchRun>;
  return typeof run.at === "string" && typeof run.score === "number";
}

/** Read the append-only run log. Always oldest → newest, never throws. */
export function readResearchHistory(metadata: unknown): ResearchRun[] {
  if (!metadata || typeof metadata !== "object") return [];
  const stored = (metadata as Record<string, unknown>)["research_history"];
  if (!Array.isArray(stored)) return [];
  return stored
    .filter(isRun)
    .map((run) => ({
      at: run.at,
      version: typeof run.version === "number" ? run.version : null,
      score: run.score,
      light: run.light ?? "neutral",
      pages: typeof run.pages === "number" ? run.pages : 0,
      evidenceCount: typeof run.evidenceCount === "number" ? run.evidenceCount : 0,
      icpVersion: typeof run.icpVersion === "number" ? run.icpVersion : null,
      metKeys: Array.isArray(run.metKeys) ? run.metKeys.map(String) : [],
    }))
    .sort((a, b) => a.at.localeCompare(b.at));
}

/** Turn a completed evaluation into the run record we keep. */
export function runFromEvaluation(evaluation: ScoutFitEvaluation, at: string): ResearchRun {
  return {
    at,
    version: evaluation.researchVersion ?? null,
    score: evaluation.score,
    light: evaluation.light,
    pages: evaluation.pagesResearched ?? 0,
    evidenceCount: evaluation.evidenceCount,
    icpVersion: evaluation.icpVersion,
    metKeys: evaluation.criteria.filter((c) => c.state === "met").map((c) => c.key),
  };
}

/** Append a run, keeping the log bounded and free of exact duplicates. */
export function appendResearchRun(
  metadata: unknown,
  run: ResearchRun,
  limit = 12,
): ResearchRun[] {
  const history = readResearchHistory(metadata).filter((entry) => entry.at !== run.at);
  return [...history, run].slice(-limit);
}

/* ------------------------------------------------------------------ *
 * Derived reads
 * ------------------------------------------------------------------ */

export function computeCoverage(candidate: ProspectCandidate): ResearchCoverage {
  const facts = candidate.facts ?? {};
  const pages = candidate.evaluation.pagesResearched ?? candidate.source.pagesResearched?.length ?? 0;
  const known = PAGE_KINDS.filter((kind) => kind.key in facts);
  const checked = PAGE_KINDS.map((kind) => ({
    key: kind.key,
    label: kind.label,
    reached: facts[kind.key] === true,
  }));

  if (candidate.source.kind !== "live_website") {
    return {
      pages,
      checked: [],
      percent: null,
      note: "Preview records are not researched, so there is no coverage to report.",
      thin: true,
    };
  }

  if (known.length === 0) {
    return {
      pages,
      checked: [],
      percent: null,
      note:
        pages > 0
          ? `${pages} public ${pages === 1 ? "page" : "pages"} were read. This research pass predates page-level coverage reporting.`
          : "No public pages have been read yet.",
      thin: pages < 3,
    };
  }

  const reached = checked.filter((kind) => kind.reached);
  const missed = checked.filter((kind) => !kind.reached).map((kind) => kind.label);
  const percent = Math.round((reached.length / checked.length) * 100);

  return {
    pages,
    checked,
    percent,
    note:
      missed.length === 0
        ? `Every page kind was reached across ${pages} public ${pages === 1 ? "page" : "pages"}.`
        : `${missed.join(", ")} ${missed.length === 1 ? "was" : "were"} never reached. Absence there is not treated as a gap.`,
    thin: percent < 50 || pages < 3,
  };
}

export function computePulse(history: ResearchRun[]): SignalPulse | null {
  if (history.length < 2) return null;
  const current = history[history.length - 1]!;
  const previous = history[history.length - 2]!;
  const gained = current.metKeys.filter((key) => !previous.metKeys.includes(key));
  const lost = previous.metKeys.filter((key) => !current.metKeys.includes(key));
  const delta = current.score - previous.score;

  const movement =
    delta > 0 ? `Fit rose ${delta} points` : delta < 0 ? `Fit fell ${Math.abs(delta)} points` : "Fit held steady";
  const evidence =
    gained.length === 0 && lost.length === 0
      ? "no criteria changed state"
      : [
          gained.length > 0 ? `${gained.length} newly met` : "",
          lost.length > 0 ? `${lost.length} no longer met` : "",
        ]
          .filter(Boolean)
          .join(", ");

  return {
    previous,
    current,
    scoreDelta: delta,
    gained,
    lost,
    summary: `${movement} since the previous read — ${evidence}.`,
  };
}

function daysSince(value: string): number | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - date.getTime()) / 86_400_000));
}

/* ------------------------------------------------------------------ *
 * Next move
 * ------------------------------------------------------------------ */

export interface CompositionInput {
  candidate: ProspectCandidate;
  activeIcpVersion: number | null;
  /** Known people at this company. Zero until the People layer lands. */
  contactCount?: number;
  /** Recorded activity events for this prospect. */
  activityCount?: number;
}

export function computeNextMove(
  input: CompositionInput,
  coverage: ResearchCoverage,
  needsRescore: boolean,
  staleDays: number | null,
): NextMove {
  const { candidate } = input;
  const { prospect, evaluation } = candidate;
  const contacts = input.contactCount ?? 0;
  const hasDecisionMaker =
    contacts > 0 || evaluation.criteria.some((c) => c.key === "decision_maker" && c.state === "met");

  if (prospect.status === "passed") {
    return {
      action: "review",
      headline: "This company was passed",
      detail: "Nothing is scheduled. Re-research it only if something about the business has changed.",
      because: "A Trust Tai member decided to pass.",
    };
  }

  if (!evaluation.scoreable || candidate.source.kind !== "live_website") {
    return {
      action: "research",
      headline: `Research ${prospect.name}`,
      detail: "Read the public website so this company can be scored against the active ICP.",
      because: "No live evidence has been read for this record yet.",
    };
  }

  if (needsRescore) {
    return {
      action: "research",
      headline: "Rescore against the current ICP",
      detail: `This was read against ICP v${evaluation.icpVersion}. The active definition is v${input.activeIcpVersion}.`,
      because: "The targeting definition changed after this company was scored.",
    };
  }

  if (staleDays !== null && staleDays >= STALE_AFTER_DAYS) {
    return {
      action: "research",
      headline: "Re-read the website",
      detail: `The evidence behind this page is ${staleDays} days old.`,
      because: "Website evidence goes out of date quietly.",
    };
  }

  if (coverage.thin && coverage.percent !== null) {
    return {
      action: "research",
      headline: "Research is still thin",
      detail: coverage.note,
      because: "Scout will not call an unread page a gap.",
    };
  }

  if (prospect.status === "qualified" || prospect.status === "ready_for_comms") {
    if (!hasDecisionMaker) {
      return {
        action: "people",
        headline: "Find the decision maker",
        detail: "Qualified, but no named person with a role is recorded. Comms cannot open without one.",
        because: "A company cannot be handed over without someone who carries it.",
      };
    }
    return {
      action: "handoff",
      headline: "Prepare the Comms handoff",
      detail: "Fit, evidence, and a decision maker are in place. Nothing is sent automatically.",
      because: "Everything Comms needs is now known.",
    };
  }

  if (evaluation.light === "red") {
    return {
      action: "review",
      headline: "Decide whether to pass",
      detail: evaluation.explanation,
      because: "The evidence read against the ICP is weak.",
    };
  }

  return {
    action: "qualify",
    headline: `Decide on ${prospect.name}`,
    detail: candidate.fit.recommendation,
    because: `The website has been read and scored ${evaluation.score}% against the active ICP.`,
  };
}

/* ------------------------------------------------------------------ *
 * Composition
 * ------------------------------------------------------------------ */

export function composeProspectPage(input: CompositionInput): ProspectComposition {
  const { candidate, activeIcpVersion } = input;
  const { evaluation, prospect } = candidate;
  const history = candidate.history ?? [];
  const coverage = computeCoverage(candidate);
  const pulse = computePulse(history);
  const staleDays = daysSince(candidate.lastCheckedAt);
  const needsRescore =
    evaluation.scoreable &&
    activeIcpVersion !== null &&
    evaluation.icpVersion !== null &&
    evaluation.icpVersion !== activeIcpVersion;

  const modules: ProspectModule[] = [
    { id: "identity", zone: "decision", weight: 100 },
    { id: "next_move", zone: "decision", weight: 90 },
  ];
  const unknown: UnknownNote[] = [];

  if (evaluation.scoreable) {
    modules.push({ id: "fit_read", zone: "decision", weight: 80 });
  } else {
    unknown.push({
      id: "fit_read",
      label: "ICP fit",
      fills: "Research the website to score this company.",
    });
  }

  const opportunity = evaluation.criteria.filter((c) =>
    ["limiting_system", "first_milestone", "roadmap_depth"].includes(c.key),
  );
  if (opportunity.some((c) => c.state === "met" || c.state === "partial")) {
    modules.push({ id: "opportunity", zone: "decision", weight: 70 });
  } else {
    unknown.push({
      id: "opportunity",
      label: "Opportunity",
      fills: "No limiting system or first milestone has been observed yet.",
    });
  }

  const contacts = input.contactCount ?? 0;
  const decisionMakerMet = evaluation.criteria.some(
    (c) => c.key === "decision_maker" && c.state === "met",
  );
  if (contacts > 0 || decisionMakerMet) {
    modules.push({ id: "people", zone: "decision", weight: 60 });
  } else {
    unknown.push({
      id: "people",
      label: "Decision maker",
      fills: "No named person with a role has been read from the public website.",
    });
  }

  if (["qualified", "ready_for_comms", "converted"].includes(prospect.status)) {
    modules.push({ id: "handoff", zone: "decision", weight: 50 });
  }

  if (candidate.signals.length > 0) {
    modules.push({ id: "observed", zone: "decision", weight: 40 });
  }

  if (pulse) modules.push({ id: "pulse", zone: "rail", weight: 90 });
  if (candidate.source.kind === "live_website") {
    modules.push({ id: "coverage", zone: "rail", weight: 80 });
  }
  if ((input.activityCount ?? 0) > 0) {
    modules.push({ id: "timeline", zone: "rail", weight: 60 });
  }

  return {
    modules: modules.sort((a, b) => b.weight - a.weight),
    unknown,
    nextMove: computeNextMove(input, coverage, needsRescore, staleDays),
    coverage,
    pulse,
    history,
    needsRescore,
    staleDays,
  };
}

/** Convenience for renderers: is this surface part of the composition? */
export function hasModule(composition: ProspectComposition, id: ProspectModule["id"]): boolean {
  return composition.modules.some((module) => module.id === id);
}
