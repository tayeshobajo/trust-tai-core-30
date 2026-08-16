/**
 * Trust Tai OS — the outcome and learning contract (Conductor V3).
 *
 * V2 proved a person can approve part of a plan and that the approved part
 * reaches the owning room through that room's own service. V3 closes the loop:
 *
 *   recommendation → approval → execution → expected signal →
 *   observed result → learning → better recommendation
 *
 * The laws encoded here:
 *
 *   - **Observation is not causation.** An observation says a signal was or
 *     was not present. It never says the action caused it.
 *   - **One result is not a rule.** A single outcome may be recorded as an
 *     observation; only repeated consistent evidence becomes a lesson.
 *   - **Human correction outranks inferred learning.** A `decided` record
 *     supersedes any `inferred` record in the same scope.
 *   - **Learning never expands authority.** No learning record can authorise
 *     an action, change a capability, or lower an approval requirement.
 *   - **No invented measurement.** With no reliable fact, the result is
 *     `unknown` / `not_measurable`, never a guessed success.
 */

import type { EvidenceRef } from "./confidence";
import type { ID, ISODateTime } from "./entities";
import type { ExpectedSignal } from "./conductor-control";
import type { Provenance } from "./activity";

/* ------------------------------------------------------------ truth class */

/**
 * How a statement is known.
 * `decided` is a human's word, `observed` is a fact read from a room's record,
 * `inferred` is the system's reading, `recommended` is a suggestion, `unknown`
 * is the honest default.
 */
export type TruthClass = "observed" | "decided" | "inferred" | "recommended" | "unknown";

export const TRUTH_RANK: Record<TruthClass, number> = {
  decided: 4,
  observed: 3,
  inferred: 2,
  recommended: 1,
  unknown: 0,
};

/** A human's word outranks anything the system worked out for itself. */
export function outranks(a: TruthClass, b: TruthClass): boolean {
  return TRUTH_RANK[a] > TRUTH_RANK[b];
}

/* --------------------------------------------------------------- metrics */

/**
 * Volume is not health. Every factory metric declares which of three things
 * it is, so the Conductor can never present output as a business outcome.
 */
export type MetricClass = "output" | "leading" | "lagging";

export const METRIC_CLASS_LABEL: Record<MetricClass, string> = {
  output: "Activity we produced",
  leading: "Early indicator",
  lagging: "Business outcome",
};

export interface FactoryMetric {
  key: string;
  label: string;
  owningApp: string;
  metricClass: MetricClass;
  /** Where the number would be read from. Never a guess. */
  observedIn: string;
}

/**
 * The connection between what rooms do and what the business actually gets.
 * Studio and Ops are enabling systems: they appear only once they hold real
 * adapters and real data, so nothing here implies coverage they do not have.
 */
export const FACTORY_METRICS: FactoryMetric[] = [
  {
    key: "scout.discovery_runs",
    label: "Discovery runs started",
    owningApp: "scout",
    metricClass: "output",
    observedIn: "scout_discovery_runs",
  },
  {
    key: "scout.qualified_accounts",
    label: "Accounts qualified",
    owningApp: "scout",
    metricClass: "leading",
    observedIn: "prospects",
  },
  {
    key: "comms.drafts_prepared",
    label: "Drafts prepared",
    owningApp: "comms",
    metricClass: "output",
    observedIn: "comms_drafts",
  },
  {
    key: "comms.replies",
    label: "Replies received",
    owningApp: "comms",
    metricClass: "leading",
    observedIn: "comms_touches",
  },
  {
    key: "comms.meetings",
    label: "Meetings held",
    owningApp: "comms",
    metricClass: "leading",
    observedIn: "conversations",
  },
  {
    key: "roadmap.decision_requests",
    label: "Decision requests raised",
    owningApp: "roadmap",
    metricClass: "output",
    observedIn: "roadmap_decisions",
  },
  {
    key: "roadmap.decisions_made",
    label: "Decisions made by a person",
    owningApp: "roadmap",
    metricClass: "leading",
    observedIn: "roadmap_decisions",
  },
  {
    key: "projects.blocker_age",
    label: "How long work has been blocked",
    owningApp: "projects",
    metricClass: "leading",
    observedIn: "projects",
  },
  {
    key: "projects.delivered",
    label: "Work delivered",
    owningApp: "projects",
    metricClass: "lagging",
    observedIn: "projects",
  },
  {
    key: "business.revenue",
    label: "Revenue recognised",
    owningApp: "business",
    metricClass: "lagging",
    observedIn: "business_figures",
  },
];

export function metricClassOf(key: string): MetricClass | undefined {
  return FACTORY_METRICS.find((metric) => metric.key === key)?.metricClass;
}

/** Output is never a business outcome, however much of it there is. */
export function isBusinessOutcome(key: string): boolean {
  return metricClassOf(key) === "lagging";
}

/* ---------------------------------------------------------- observations */

export type ResultClassification =
  /** The expected signal was found in the owning room's record. */
  | "signal_present"
  /** The room was readable and the signal was not there. */
  | "signal_absent"
  /** Something happened, but not the whole signal. */
  | "partial"
  /** No reliable way to read this signal today. Not a failure. */
  | "not_measurable"
  /** Not looked at yet, or the window has not opened. */
  | "unknown";

export const RESULT_LABEL: Record<ResultClassification, string> = {
  signal_present: "The expected signal is there",
  signal_absent: "The expected signal is not there",
  partial: "Part of the signal is there",
  not_measurable: "Nothing reliable to measure this with yet",
  unknown: "Not measured yet",
};

export type OutcomeStatus = "pending" | "measured" | "inconclusive";

/**
 * One measurement of one governed action against its own expected signal.
 *
 * It links the whole chain back — recommendation, plan, action — so provenance
 * survives from the sentence that suggested the work to the fact that says
 * what happened. It stores references and evidence, never a copy of the room's
 * record.
 */
export interface ActionObservation {
  id: ID;
  organizationId: ID;
  actionId: ID;
  /** The reasoning this descends from. References only. */
  recommendationId?: ID;
  answerId?: ID;
  planId?: ID;
  owningApp: string;
  operation: string;
  expectedSignal: ExpectedSignal;
  /** When the signal could reasonably be looked for. Omitted when unknown. */
  observationWindow?: { from: ISODateTime; to?: ISODateTime };
  observedEvidence: EvidenceRef[];
  result: ResultClassification;
  /** How the result is known. `observed` only when a room's record said so. */
  truth: TruthClass;
  confidence: "high" | "moderate" | "low" | "unknown";
  /** The factory metric this speaks to, when it speaks to one. */
  metricKey?: string;
  metricClass?: MetricClass;
  outcomeStatus: OutcomeStatus;
  measuredAt: ISODateTime;
  observedAt?: ISODateTime;
  provenance: Provenance;
}

/** An observation with no evidence may never claim a present signal. */
export function isHonestObservation(observation: ActionObservation): boolean {
  if (observation.result === "signal_present") {
    return observation.observedEvidence.length > 0 && observation.truth !== "inferred";
  }
  if (observation.result === "unknown" || observation.result === "not_measurable") {
    return observation.confidence === "unknown" || observation.confidence === "low";
  }
  return true;
}

/* -------------------------------------------------------------- learning */

export type LearningConfidence = "none" | "low" | "moderate" | "high";

/** Three consistent results before anything may be called a pattern. */
export const RULE_THRESHOLD = 3;

/**
 * One append-only learning record.
 *
 * It is judgment about the Conductor's own recommendations — never a copy of
 * business truth, and never a permission. `grantsAuthority` is typed `false`
 * so no code path can set it otherwise.
 */
export interface LearningRecord {
  id: ID;
  organizationId: ID;
  /** What the lesson is about: one room, one operation. */
  scope: { owningApp: string; operation: string };
  sourceActionIds: ID[];
  sourceObservationIds: ID[];
  recommendationId?: ID;
  hypothesis: string;
  expectedSignal: string;
  observedResult: string;
  evidence: EvidenceRef[];
  confidence: LearningConfidence;
  /** One sentence a person can read. Never a causal claim. */
  lesson: string;
  /** `observed` for inferred patterns, `decided` for a human's correction. */
  basis: TruthClass;
  /** False until the evidence threshold is met. A single result is not a rule. */
  isRule: boolean;
  grantsAuthority: false;
  recordedAt: ISODateTime;
  supersedes?: ID;
  contradicts?: ID;
}

export function scopeKey(scope: { owningApp: string; operation: string }): string {
  return `${scope.owningApp}:${scope.operation}`;
}

/**
 * The one question the rest of the system may ask about learning and
 * authority. The answer is always no.
 */
export function learningGrantsExecution(_record: LearningRecord): false {
  return false;
}
