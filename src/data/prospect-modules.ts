/**
 * Scout — adaptive composition for the prospect workspace.
 *
 * Pure functions only. Given what is stored for a company, decide which
 * surfaces are worth showing, what changed since last time, and the single
 * next move. No rendering, no Supabase, no side effects.
 */

import type { ConfidenceRead, EvidenceRef } from "@/domain/confidence";
import type {
  ModuleEmphasis,
  NextMove,
  ProspectComposition,
  ProspectModule,
  ResearchCoverage,
  ResearchRun,
  SignalPulse,
  UnknownNote,
} from "@/domain/prospect-modules";
import type { ProspectCandidate } from "@/domain/scout";
import type { FitCriterion, ScoutFitEvaluation } from "@/domain/scout-fit";

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
 * Confidence — how sure we are, and what that rests on
 * ------------------------------------------------------------------ */

/** Evidence for one ICP criterion: the pages the claim was actually read from. */
export function criterionEvidence(criterion: FitCriterion): EvidenceRef[] {
  const pages = (criterion.sourceUrls ?? []).map((url) => ({
    label: pageLabel(url),
    url,
    kind: "page" as const,
  }));
  if (pages.length > 0) return pages;
  return [{ label: "Evaluator read of stored evidence", kind: "computed" as const }];
}

function pageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/$/, "");
    return path && path !== "" ? `${parsed.hostname}${path}` : parsed.hostname;
  } catch {
    return url;
  }
}

/**
 * Confidence in one criterion. Evidence quantity sets the ceiling; thin
 * coverage lowers it. A criterion nobody has evidence for is never "low" —
 * it is simply not established.
 */
export function criterionConfidence(
  criterion: FitCriterion,
  coverage: ResearchCoverage,
): ConfidenceRead {
  const evidence = criterionEvidence(criterion);
  const sourced = (criterion.sourceUrls ?? []).length;

  if (criterion.state === "missing") {
    return {
      level: "unknown",
      because:
        sourced > 0
          ? "Pages were read but said nothing either way about this."
          : "No page carrying this has been read yet, so absence proves nothing.",
      evidence,
    };
  }

  const base: ConfidenceRead =
    criterion.state === "met" && sourced > 0
      ? {
          level: "high",
          because: `Stated directly on ${sourced} public ${sourced === 1 ? "page" : "pages"}.`,
          evidence,
        }
      : criterion.state === "mismatch"
        ? {
            level: sourced > 0 ? "high" : "moderate",
            because: "The evidence read contradicts the ICP on this point.",
            evidence,
          }
        : {
            level: sourced > 0 ? "moderate" : "low",
            because:
              sourced > 0
                ? "Partly supported: the pages hint at this without stating it."
                : "Derived from stored evidence with no page to point at.",
            evidence,
          };

  return coverage.thin
    ? {
        ...base,
        level: base.level === "high" ? "moderate" : base.level,
        because: `${base.because} Coverage is still thin, so this is held one step lower.`,
      }
    : base;
}

/** Confidence in the overall fit read that the page's move depends on. */
export function fitConfidence(
  candidate: ProspectCandidate,
  coverage: ResearchCoverage,
  needsRescore: boolean,
  staleDays: number | null,
): ConfidenceRead {
  const { evaluation } = candidate;
  const evidence: EvidenceRef[] = [
    {
      label: `${evaluation.evidenceCount} observed ${evaluation.evidenceCount === 1 ? "fact" : "facts"}`,
      kind: "computed",
    },
    ...(candidate.prospect.websiteUrl
      ? [{ label: pageLabel(candidate.prospect.websiteUrl), url: candidate.prospect.websiteUrl, kind: "page" as const }]
      : []),
  ];

  if (!evaluation.scoreable) {
    return {
      level: "unknown",
      because: "This record has never been scored against live website evidence.",
      evidence,
    };
  }
  if (needsRescore) {
    return {
      level: "low",
      because: "The ICP changed after this company was scored, so the read is out of date.",
      evidence,
    };
  }
  if (staleDays !== null && staleDays >= STALE_AFTER_DAYS) {
    return {
      level: "low",
      because: `The evidence behind this read is ${staleDays} days old.`,
      evidence,
    };
  }
  if (coverage.thin) {
    return {
      level: "moderate",
      because: coverage.note,
      evidence,
    };
  }
  return {
    level: evaluation.evidenceCount >= 4 ? "high" : "moderate",
    because: `Scored ${evaluation.score}% from ${evaluation.evidenceCount} facts read across ${coverage.pages} public ${coverage.pages === 1 ? "page" : "pages"}.`,
    evidence,
  };
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

type NextMoveBase = Omit<NextMove, "confidence">;

/**
 * The deterministic decision rules. Read top to bottom: the first rule that
 * matches wins, so the same evidence always produces the same move.
 */
export function computeNextMove(
  input: CompositionInput,
  coverage: ResearchCoverage,
  needsRescore: boolean,
  staleDays: number | null,
): NextMove {
  const base = nextMoveBase(input, coverage, needsRescore, staleDays);
  const contacts = input.contactCount ?? 0;

  if (base.action === "people") {
    return {
      ...base,
      confidence: {
        level: "unknown",
        because: "Nobody with a role is on record, so reachability cannot be judged yet.",
        evidence: [{ label: `${contacts} people on record`, kind: "computed" }],
      },
    };
  }

  if (base.action === "handoff") {
    return {
      ...base,
      confidence: {
        level: coverage.thin ? "moderate" : "high",
        because: `Fit, evidence, and ${contacts} named ${contacts === 1 ? "person" : "people"} are on record.`,
        evidence: [
          { label: `${contacts} people on record`, kind: "computed" },
          ...fitConfidence(input.candidate, coverage, needsRescore, staleDays).evidence,
        ],
      },
    };
  }

  return {
    ...base,
    confidence: fitConfidence(input.candidate, coverage, needsRescore, staleDays),
  };
}

function nextMoveBase(
  input: CompositionInput,
  coverage: ResearchCoverage,
  needsRescore: boolean,
  staleDays: number | null,
): NextMoveBase {
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
 * Emphasis — which surface the page leans on, decided by rule
 * ------------------------------------------------------------------ */

const FOCUS_BY_ACTION: Record<NextMove["action"], ProspectModule["id"]> = {
  research: "coverage",
  qualify: "fit_read",
  people: "people",
  handoff: "handoff",
  review: "fit_read",
};

const EMPHASIS_LIFT: Record<ModuleEmphasis, number> = {
  primary: 25,
  supporting: 0,
  quiet: -30,
};

interface EmphasisInput {
  focus: ProspectModule["id"];
  status: string;
  light: ScoutFitEvaluation["light"];
  coverage: ResearchCoverage;
  needsRescore: boolean;
}

/**
 * Deterministic emphasis. Same stage + same fit + same coverage always
 * produces the same layout, so the page changes only when the evidence does.
 */
export function emphasisFor(
  id: ProspectModule["id"],
  input: EmphasisInput,
): { emphasis: ModuleEmphasis; reason: string } {
  if (id === "identity" || id === "next_move") {
    return { emphasis: "primary", reason: "The page always states who this is and the move." };
  }

  if (id === input.focus) {
    return { emphasis: "primary", reason: "This is what the next move depends on." };
  }

  // Evidence is not trustworthy enough to lead with a judgement yet.
  if (input.needsRescore || input.coverage.thin) {
    if (id === "coverage") {
      return { emphasis: "primary", reason: "Coverage decides how far the rest can be trusted." };
    }
    if (id === "fit_read" || id === "opportunity") {
      return { emphasis: "quiet", reason: "Held back until the evidence behind it is current." };
    }
  }

  if (id === "handoff") {
    return ["qualified", "ready_for_comms", "converted"].includes(input.status)
      ? { emphasis: "supporting", reason: "The company is past qualification." }
      : { emphasis: "quiet", reason: "Not relevant before this company is qualified." };
  }

  if (id === "people") {
    return ["qualified", "ready_for_comms"].includes(input.status)
      ? { emphasis: "supporting", reason: "Reachability is what stands between here and Comms." }
      : { emphasis: "quiet", reason: "People matter once the company is qualified." };
  }

  if (id === "opportunity") {
    return input.light === "red"
      ? { emphasis: "quiet", reason: "The fit read is weak, so the opportunity is secondary." }
      : { emphasis: "supporting", reason: "Shapes the first conversation once fit holds." };
  }

  if (id === "observed" || id === "timeline") {
    return { emphasis: "quiet", reason: "Background record, not a decision." };
  }

  return { emphasis: "supporting", reason: "Context for the current decision." };
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

  const nextMove = computeNextMove(input, coverage, needsRescore, staleDays);
  const focus = FOCUS_BY_ACTION[nextMove.action];
  const push = (
    id: ProspectModule["id"],
    zone: ProspectModule["zone"],
    weight: number,
  ) => {
    const { emphasis, reason } = emphasisFor(id, {
      focus,
      status: prospect.status,
      light: evaluation.light,
      coverage,
      needsRescore,
    });
    modules.push({
      id,
      zone,
      weight: weight + EMPHASIS_LIFT[emphasis],
      emphasis,
      reason,
    });
  };

  const modules: ProspectModule[] = [];
  push("identity", "decision", 100);
  push("next_move", "decision", 90);
  const unknown: UnknownNote[] = [];

  if (evaluation.scoreable) {
    push("fit_read", "decision", 80);
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
    push("opportunity", "decision", 70);
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
    push("people", "decision", 60);
  } else {
    unknown.push({
      id: "people",
      label: "Decision maker",
      fills: "No named person with a role has been read from the public website.",
    });
  }

  if (["qualified", "ready_for_comms", "converted"].includes(prospect.status)) {
    push("handoff", "decision", 50);
  }

  if (candidate.signals.length > 0) {
    push("observed", "decision", 40);
  }

  if (pulse) push("pulse", "rail", 90);
  if (candidate.source.kind === "live_website") {
    push("coverage", "rail", 80);
  }
  if ((input.activityCount ?? 0) > 0) {
    push("timeline", "rail", 60);
  }

  return {
    modules: modules.sort((a, b) => b.weight - a.weight),
    focus,
    confidence: fitConfidence(candidate, coverage, needsRescore, staleDays),
    unknown,
    nextMove,
    coverage,
    pulse,
    history,
    needsRescore,
    staleDays,
  };
}

/** Convenience for renderers: is this surface part of the composition? */
/** The layout weight the composer chose for a module, if it is present. */
export function emphasisOf(
  composition: ProspectComposition,
  id: ProspectModule["id"],
): ModuleEmphasis | undefined {
  return composition.modules.find((module) => module.id === id)?.emphasis;
}

export function hasModule(composition: ProspectComposition, id: ProspectModule["id"]): boolean {
  return composition.modules.some((module) => module.id === id);
}
