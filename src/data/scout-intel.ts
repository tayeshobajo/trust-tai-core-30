/**
 * Scout, reading and scoring the decision intelligence for a company.
 *
 * Pure functions only. Nothing here fetches; everything is derived from what
 * was already stored, so the same read can be tested without a network or a
 * renderer.
 *
 * Two rules hold throughout:
 *  1. Absence is unknown, never a negative. A missing signal lowers confidence,
 *     it never invents a mismatch.
 *  2. Preview/demo rows are never ranked against researched companies.
 */

import {
  EMPTY_INTEL,
  isOpportunityArea,
  METRIC_LABEL,
  type BuyingSignal,
  type DecisionMetric,
  type DecisionMetrics,
  type DigitalOpportunity,
  type DiscoveredPerson,
  type MetricKey,
  type ScoutIntel,
} from "@/domain/scout-intel";
import type { Person } from "@/domain/people";
import type { ProspectCandidate } from "@/domain/scout";
import type { ResearchCoverage } from "@/domain/prospect-modules";

type Row = Record<string, unknown>;

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter((v): v is Row => !!v && typeof v === "object") : [];
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.map(str).filter(Boolean) : [];
}

function toSignal(entry: Row): BuyingSignal | null {
  const statement = str(entry["statement"]) || str(entry["signal"]) || str(entry["summary"]);
  if (!statement) return null;
  const sourceUrl = str(entry["source_url"]) || str(entry["url"]);
  const observedAt = str(entry["observed_at"]) || str(entry["date"]);
  return {
    type: str(entry["type"]) || "signal",
    statement,
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(observedAt ? { observedAt } : {}),
  };
}

function toOpportunity(entry: Row): DigitalOpportunity | null {
  const statement = str(entry["statement"]) || str(entry["issue"]) || str(entry["summary"]);
  if (!statement) return null;
  const rawArea = str(entry["area"]).toLowerCase().replace(/[\s-]+/g, "_");
  const sourceUrl = str(entry["source_url"]) || str(entry["url"]);
  return {
    area: isOpportunityArea(rawArea) ? rawArea : "ux",
    statement,
    evidence: str(entry["evidence"]) || "No supporting detail was recorded for this observation.",
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

function toPerson(entry: Row): DiscoveredPerson | null {
  const fullName = str(entry["full_name"]) || str(entry["name"]);
  if (!fullName) return null;
  const raw = str(entry["decision_maker_likelihood"]).toLowerCase();
  const likelihood: DiscoveredPerson["decisionMakerLikelihood"] =
    raw === "high" || raw === "moderate" || raw === "low" ? raw : "unknown";
  const roleTitle = str(entry["role_title"]) || str(entry["title"]);
  const linkedinUrl = str(entry["linkedin_url"]);
  const email = str(entry["email"]);
  const sourceUrl = str(entry["source_url"]) || str(entry["url"]);
  return {
    fullName,
    ...(roleTitle ? { roleTitle } : {}),
    ...(linkedinUrl ? { linkedinUrl } : {}),
    ...(email ? { email } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    decisionMakerLikelihood: likelihood,
  };
}

/**
 * Read the intel block a discovery or research pass stored on the row.
 * Older rows simply have nothing here, that is a valid, honest empty state.
 */
export function readScoutIntel(metadata: unknown): ScoutIntel {
  const meta = (metadata && typeof metadata === "object" ? metadata : {}) as Row;
  const block = (meta["scout_intel"] ?? {}) as Row;
  if (!block || typeof block !== "object") return EMPTY_INTEL;

  const collectedAt = str(block["collected_at"]);
  return {
    buyingSignals: rows(block["buying_signals"])
      .map(toSignal)
      .filter((v): v is BuyingSignal => v !== null),
    opportunities: rows(block["opportunities"])
      .map(toOpportunity)
      .filter((v): v is DigitalOpportunity => v !== null),
    people: rows(block["people"])
      .map(toPerson)
      .filter((v): v is DiscoveredPerson => v !== null),
    unknowns: strings(block["unknowns"]),
    ...(collectedAt ? { collectedAt } : {}),
    citations: strings(block["citations"]),
  };
}

/** Serialize intel back into the shape stored under `metadata.scout_intel`. */
export function writeScoutIntel(intel: ScoutIntel): Row {
  return {
    buying_signals: intel.buyingSignals.map((signal) => ({
      type: signal.type,
      statement: signal.statement,
      source_url: signal.sourceUrl ?? null,
      observed_at: signal.observedAt ?? null,
    })),
    opportunities: intel.opportunities.map((item) => ({
      area: item.area,
      statement: item.statement,
      evidence: item.evidence,
      source_url: item.sourceUrl ?? null,
    })),
    people: intel.people.map((person) => ({
      full_name: person.fullName,
      role_title: person.roleTitle ?? null,
      linkedin_url: person.linkedinUrl ?? null,
      email: person.email ?? null,
      source_url: person.sourceUrl ?? null,
      decision_maker_likelihood: person.decisionMakerLikelihood,
    })),
    unknowns: intel.unknowns,
    collected_at: intel.collectedAt ?? new Date().toISOString(),
    citations: intel.citations,
  };
}

const RECENT_DAYS = 180;

function daysSince(iso: string | undefined, now: Date): number | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((now.getTime() - at) / 86_400_000));
}

/** Signals with a date inside the recency window carry the timing read. */
export function recentSignals(
  signals: BuyingSignal[],
  now: Date = new Date(),
): BuyingSignal[] {
  return signals.filter((signal) => {
    const age = daysSince(signal.observedAt, now);
    return age === null ? false : age <= RECENT_DAYS;
  });
}

/** Documented weights. Visible in the UI so ranking is never a black box. */
export const METRIC_WEIGHTS: Record<MetricKey, number> = {
  icp_match: 0.3,
  opportunity_readiness: 0.2,
  evidence_confidence: 0.2,
  reachability: 0.15,
  timing: 0.15,
  research_coverage: 0,
};

export interface MetricsInput {
  candidate: ProspectCandidate;
  intel: ScoutIntel;
  people: Person[];
  coverage?: ResearchCoverage | null;
  now?: Date;
}

function reachabilityRead(people: Person[], intel: ScoutIntel): { value: number; because: string } {
  if (people.length === 0 && intel.people.length === 0) {
    return { value: 0, because: "No named person has been found yet." };
  }
  const verified = people.find((p) => p.emailStatus === "verified");
  if (verified) {
    return { value: 100, because: `${verified.fullName} has a verified business email.` };
  }
  const found = people.find((p) => p.emailStatus === "found" && p.email);
  if (found) {
    return {
      value: 70,
      because: `${found.fullName} has an email that has not been verified yet.`,
    };
  }
  const linkedin = people.find((p) => p.linkedinUrl) ?? null;
  if (linkedin) {
    return { value: 45, because: `${linkedin.fullName} has a profile link but no email route.` };
  }
  const named = people[0] ?? null;
  if (named) {
    return { value: 30, because: `${named.fullName} is named, but no contact route is known.` };
  }
  return {
    value: 20,
    because: `${intel.people.length} person read from public pages, not yet saved as a contact.`,
  };
}

function opportunityRead(intel: ScoutIntel): { value: number; because: string } {
  const withEvidence = intel.opportunities.filter((item) => item.sourceUrl || item.evidence);
  if (withEvidence.length === 0) {
    return { value: 0, because: "No specific digital problem has been observed yet." };
  }
  const cited = withEvidence.filter((item) => item.sourceUrl).length;
  const value = Math.min(100, withEvidence.length * 25 + cited * 15);
  return {
    value,
    because: `${withEvidence.length} observed problem${withEvidence.length === 1 ? "" : "s"} Trust Tai can fix, ${cited} with a page reference.`,
  };
}

function timingRead(intel: ScoutIntel, now: Date): { value: number; because: string } {
  if (intel.buyingSignals.length === 0) {
    return { value: 0, because: "No public buying signal has been found. Unknown, not negative." };
  }
  const recent = recentSignals(intel.buyingSignals, now);
  if (recent.length === 0) {
    return {
      value: 35,
      because: `${intel.buyingSignals.length} signal${intel.buyingSignals.length === 1 ? "" : "s"} found, none of them dated inside the last six months.`,
    };
  }
  return {
    value: Math.min(100, 50 + recent.length * 20),
    because: `${recent.length} dated signal${recent.length === 1 ? "" : "s"} in the last six months.`,
  };
}

function evidenceRead(candidate: ProspectCandidate): { value: number | null; because: string } {
  if (!candidate.evaluation.scoreable) {
    return { value: null, because: "This record has never been researched." };
  }
  const cited = candidate.evaluation.criteria.filter(
    (criterion) => (criterion.sourceUrls?.length ?? 0) > 0,
  ).length;
  const evidence = candidate.evaluation.evidenceCount;
  const value = Math.min(100, evidence * 12 + cited * 12);
  return {
    value,
    because: `${evidence} distinct evidence point${evidence === 1 ? "" : "s"}, ${cited} tied to a source page.`,
  };
}

/**
 * The six decision metrics plus a documented priority score.
 *
 * Priority is a weighted blend, but the blend never replaces the parts: every
 * metric keeps its own value and its own reason, and the explanation names the
 * weights that produced the number.
 */
export function computeDecisionMetrics(input: MetricsInput): DecisionMetrics {
  const { candidate, intel, people } = input;
  const now = input.now ?? new Date();
  const scoreable = candidate.evaluation.scoreable;

  const evidence = evidenceRead(candidate);
  const reach = reachabilityRead(people, intel);
  const opportunity = opportunityRead(intel);
  const timing = timingRead(intel, now);
  const coveragePercent = input.coverage?.percent ?? null;

  const metrics: DecisionMetric[] = [
    {
      key: "icp_match",
      label: METRIC_LABEL.icp_match,
      value: scoreable ? candidate.evaluation.score : null,
      because: scoreable
        ? candidate.evaluation.explanation
        : "Not scoreable, no live evidence has been read for this record.",
      weight: METRIC_WEIGHTS.icp_match,
    },
    {
      key: "evidence_confidence",
      label: METRIC_LABEL.evidence_confidence,
      value: evidence.value,
      because: evidence.because,
      weight: METRIC_WEIGHTS.evidence_confidence,
    },
    {
      key: "research_coverage",
      label: METRIC_LABEL.research_coverage,
      value: coveragePercent,
      because:
        input.coverage?.note ?? "Coverage of the public website has not been measured yet.",
      weight: METRIC_WEIGHTS.research_coverage,
    },
    {
      key: "reachability",
      label: METRIC_LABEL.reachability,
      value: scoreable ? reach.value : null,
      because: scoreable ? reach.because : "Nobody can be reached from a record with no research.",
      weight: METRIC_WEIGHTS.reachability,
    },
    {
      key: "opportunity_readiness",
      label: METRIC_LABEL.opportunity_readiness,
      value: scoreable ? opportunity.value : null,
      because: scoreable ? opportunity.because : "No work has been observed on this record.",
      weight: METRIC_WEIGHTS.opportunity_readiness,
    },
    {
      key: "timing",
      label: METRIC_LABEL.timing,
      value: scoreable ? timing.value : null,
      because: scoreable ? timing.because : "No timing evidence has been read.",
      weight: METRIC_WEIGHTS.timing,
    },
  ];

  if (!scoreable) {
    return {
      metrics,
      priority: null,
      priorityExplanation:
        "This record is not ranked. It has never been researched, so it is never allowed to compete with companies that have real evidence behind them.",
    };
  }

  let total = 0;
  const parts: string[] = [];
  for (const metric of metrics) {
    if (metric.weight === 0 || metric.value === null) continue;
    total += metric.value * metric.weight;
    parts.push(`${metric.label} ${metric.value} × ${metric.weight}`);
  }
  const priority = Math.round(Math.max(0, Math.min(100, total)));

  return {
    metrics,
    priority,
    priorityExplanation: `Priority ${priority} = ${parts.join(" + ")}. Fit carries the most weight, then the size of the opportunity, then how well evidenced and how reachable the company is.`,
  };
}

/** Highest priority first. Unranked records always sort last, never first. */
export function byPriority(
  a: { priority: number | null },
  b: { priority: number | null },
): number {
  if (a.priority === null && b.priority === null) return 0;
  if (a.priority === null) return 1;
  if (b.priority === null) return -1;
  return b.priority - a.priority;
}
