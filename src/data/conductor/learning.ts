/**
 * The learning ledger's rules (Conductor V3).
 *
 * Learning here means one thing only: the Conductor getting better at judging
 * its own recommendations. It is not a second copy of business truth, and it
 * can never become permission.
 *
 * Deterministic guardrails, in order of authority:
 *
 *   1. A human correction (`decided`) outranks anything inferred, always.
 *   2. One result is an observation, never a rule. Three consistent results
 *      in the same scope are needed before `isRule` is true.
 *   3. Contradictory evidence lowers confidence or supersedes the prior
 *      record. Nothing is overwritten; the ledger is append-only.
 *   4. No causal wording unless the evidence supports causality. Otherwise
 *      the lesson is phrased as an observed association.
 *   5. No lesson grants authority. `grantsAuthority` is `false` by type.
 */

import type {
  ActionObservation,
  LearningConfidence,
  LearningRecord,
  TruthClass,
} from "@/domain/outcomes";
import { RULE_THRESHOLD, outranks, scopeKey } from "@/domain/outcomes";
import type { EvidenceRef } from "@/domain/confidence";
import type { ID } from "@/domain/entities";

/* ------------------------------------------------------------ confidence */

/**
 * Confidence from consistency, not from volume.
 * Below the threshold nothing is a rule, however encouraging one result was.
 */
export function confidenceFor(input: {
  consistent: number;
  contradicting: number;
}): LearningConfidence {
  const { consistent, contradicting } = input;
  if (consistent === 0) return "none";
  if (contradicting >= consistent) return "low";
  if (consistent >= RULE_THRESHOLD + 2 && contradicting === 0) return "high";
  if (consistent >= RULE_THRESHOLD) return "moderate";
  return "low";
}

const CONFIDENCE_RANK: Record<LearningConfidence, number> = {
  none: 0,
  low: 1,
  moderate: 2,
  high: 3,
};

export function confidenceRose(from: LearningConfidence, to: LearningConfidence): boolean {
  return CONFIDENCE_RANK[to] > CONFIDENCE_RANK[from];
}

/* --------------------------------------------------------------- wording */

/**
 * Causal language needs causal evidence: a person saying so, or a controlled
 * comparison. Otherwise the lesson is stated as what was observed alongside.
 */
export function phraseLesson(input: {
  scopeLabel: string;
  consistent: number;
  contradicting: number;
  outcome: "present" | "absent" | "mixed";
  causal: boolean;
}): string {
  const { scopeLabel, consistent, contradicting, outcome, causal } = input;
  const runs = `${consistent} of ${consistent + contradicting}`;
  if (outcome === "mixed") {
    return `${scopeLabel} has produced mixed results (${runs} reached the expected signal). Not enough consistency to say anything firm.`;
  }
  const observed =
    outcome === "present"
      ? `reached its expected signal in ${runs} approved runs`
      : `did not reach its expected signal in ${runs} approved runs`;
  if (causal) {
    return `${scopeLabel} ${observed}, and the evidence supports the connection.`;
  }
  return `${scopeLabel} ${observed}. Observed alongside, not shown to be the cause.`;
}

/* ---------------------------------------------------------- distillation */

export interface DistillInput {
  organizationId: ID;
  scope: { owningApp: string; operation: string };
  scopeLabel: string;
  observations: ActionObservation[];
  /** Prior record in this scope, if any. Never edited, only superseded. */
  prior?: LearningRecord | undefined;
  /** A person's correction outranks everything inferred here. */
  humanCorrection?: { statement: string; by: string; at: string } | undefined;
  now?: string;
}

/**
 * Turn observations into at most one new ledger record.
 *
 * Returns `undefined` when there is nothing honest to add, no observations,
 * or nothing changed since the prior record.
 */
export function distillLearning(input: DistillInput): LearningRecord | undefined {
  const at = input.now ?? new Date().toISOString();
  const measured = input.observations.filter(
    (observation) => observation.outcomeStatus === "measured",
  );

  /* A person's word. Recorded as decided, superseding any inference. */
  if (input.humanCorrection) {
    const basis: TruthClass = "decided";
    if (input.prior && !outranks(basis, input.prior.basis) && input.prior.lesson === input.humanCorrection.statement) {
      return undefined;
    }
    return {
      id: `learning:${scopeKey(input.scope)}:${at}`,
      organizationId: input.organizationId,
      scope: input.scope,
      sourceActionIds: measured.map((observation) => observation.actionId),
      sourceObservationIds: measured.map((observation) => observation.id),
      hypothesis: `${input.scopeLabel} works the way the Conductor assumed.`,
      expectedSignal: measured[0]?.expectedSignal.statement ?? "-",
      observedResult: "A person corrected the Conductor's reading.",
      evidence: [
        { label: `${input.humanCorrection.by} corrected this`, kind: "human" } as EvidenceRef,
      ],
      confidence: "high",
      lesson: input.humanCorrection.statement,
      basis,
      /* A person's correction is authoritative immediately: it needs no threshold. */
      isRule: true,
      grantsAuthority: false,
      recordedAt: at,
      ...(input.prior ? { supersedes: input.prior.id } : {}),
    };
  }

  if (measured.length === 0) return undefined;

  /* A prior human decision is not overturned by inference. */
  if (input.prior?.basis === "decided") return undefined;

  const consistent = measured.filter((observation) => observation.result === "signal_present").length;
  const contradicting = measured.filter(
    (observation) => observation.result === "signal_absent" || observation.result === "partial",
  ).length;

  const outcome: "present" | "absent" | "mixed" =
    consistent > 0 && contradicting > 0 ? "mixed" : consistent > 0 ? "present" : "absent";
  const dominant = Math.max(consistent, contradicting);
  const confidence = confidenceFor({
    consistent: dominant,
    contradicting: Math.min(consistent, contradicting),
  });
  const isRule = outcome !== "mixed" && dominant >= RULE_THRESHOLD;

  const record: LearningRecord = {
    id: `learning:${scopeKey(input.scope)}:${at}`,
    organizationId: input.organizationId,
    scope: input.scope,
    sourceActionIds: measured.map((observation) => observation.actionId),
    sourceObservationIds: measured.map((observation) => observation.id),
    hypothesis: `Approving ${input.scopeLabel} produces "${measured[0]!.expectedSignal.statement}".`,
    expectedSignal: measured[0]!.expectedSignal.statement,
    observedResult: `${consistent} reached the signal, ${contradicting} did not.`,
    evidence: measured.flatMap((observation) => observation.observedEvidence).slice(0, 8),
    confidence,
    lesson: phraseLesson({
      scopeLabel: input.scopeLabel,
      consistent: dominant,
      contradicting: Math.min(consistent, contradicting),
      outcome,
      /* Nothing in this loop is a controlled comparison, so never causal. */
      causal: false,
    }),
    basis: "observed",
    isRule,
    grantsAuthority: false,
    recordedAt: at,
    ...(input.prior ? { supersedes: input.prior.id } : {}),
    ...(input.prior && contradictsPrior(input.prior, outcome) ? { contradicts: input.prior.id } : {}),
  };

  /* Nothing new to say. Keep the ledger quiet rather than repeating itself. */
  if (
    input.prior &&
    input.prior.lesson === record.lesson &&
    input.prior.confidence === record.confidence
  ) {
    return undefined;
  }
  return record;
}

function contradictsPrior(prior: LearningRecord, outcome: "present" | "absent" | "mixed"): boolean {
  if (outcome === "mixed") return false;
  const priorPositive = prior.observedResult.startsWith("0 reached") === false && prior.isRule;
  return priorPositive && outcome === "absent";
}

/* ---------------------------------------------------------- retrieval */

/**
 * Bounded, relevant recall for a reasoning packet.
 *
 * Never the whole history: only live records for the rooms in play, strongest
 * first, capped. A superseded record is not recalled.
 */
export function relevantLearning(input: {
  records: LearningRecord[];
  rooms: string[];
  operations?: string[];
  limit?: number;
}): LearningRecord[] {
  const superseded = new Set(
    input.records.map((record) => record.supersedes).filter(Boolean) as string[],
  );
  return input.records
    .filter((record) => !superseded.has(record.id))
    .filter((record) => input.rooms.includes(record.scope.owningApp))
    .filter(
      (record) => !input.operations || input.operations.includes(record.scope.operation),
    )
    .filter((record) => record.confidence !== "none")
    .sort((a, b) => {
      /* A person's decision comes first, whatever the inference says. */
      const decided = Number(b.basis === "decided") - Number(a.basis === "decided");
      if (decided !== 0) return decided;
      const rank = CONFIDENCE_RANK[b.confidence] - CONFIDENCE_RANK[a.confidence];
      if (rank !== 0) return rank;
      return b.recordedAt.localeCompare(a.recordedAt);
    })
    .slice(0, input.limit ?? 5);
}

/**
 * The sentences a reasoning packet may cite, with their basis attached so the
 * model can never present thin evidence as settled.
 */
export function learningForPacket(records: LearningRecord[]): string[] {
  return records.map((record) => {
    const strength =
      record.basis === "decided"
        ? "a person's correction"
        : record.isRule
          ? `a pattern across ${record.sourceObservationIds.length} results`
          : "one or two results only, too thin to rely on";
    return `${record.lesson} (${strength})`;
  });
}
