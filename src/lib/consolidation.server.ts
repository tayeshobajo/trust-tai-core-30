/**
 * Consolidation: pass 3 of the judgment learning engine (Step 5).
 *
 * Weekly rhythm, not the intelligence boundary (ruling 2): reflection ran
 * continuously; this pass clusters what it produced against the existing
 * principle store, applies lifecycle transitions through the pure state
 * machine, computes graduation recommendations per decision class, and
 * writes the training-debt report. Deterministic wherever it can be:
 * clustering is scope-plus-contradiction matching in code, so every merge
 * is explainable line by line. A model pass may later refine clustering;
 * it will never change the lifecycle rules.
 *
 * Contradictions NEVER auto-resolve: they are flagged for Tai (exceptions,
 * not traffic). Authority stays under MANUAL_V1_POLICY: the engine
 * recommends, a human authorizes, and nothing here touches send authority.
 */

import type { CandidatePrinciple, LearningUnit } from "@/domain/learning-unit";
import {
  applyContradictingEvidence,
  applySupportingEvidence,
  INFLUENCING_STATUSES,
  type EvidenceRef,
  type Principle,
} from "@/domain/principle-lifecycle";
import {
  MANUAL_V1_POLICY,
  recommendAuthority,
  type AuthorityPolicy,
  type AuthorityRecommendation,
  type DecisionClassSummary,
} from "@/domain/authority-policy";

export interface CandidateWithUnit {
  candidate: CandidatePrinciple;
  unit: LearningUnit;
}

export interface TrainingDebtItem {
  decisionClass: string;
  occurrences: number;
  whyTai: string;
  judgmentMissing: string;
  learnable: boolean;
  graduationEvidence: string;
}

export interface TrainingDebtReport {
  /** Leads with the classes that consumed most of Tai's attention. */
  topDebtItems: TrainingDebtItem[];
  totalEscalationsAndApprovals: number;
}

export interface ConsolidationResult {
  /** The full post-consolidation store state to persist (upserts only). */
  principles: Principle[];
  /** New provisional principles born this pass. */
  newProvisional: Principle[];
  /** Lifecycle transitions applied, for the weekly report. */
  transitions: { principleId: string; from: string; to: string; reason: string }[];
  /** Contradiction pairs. Never auto-resolved; Tai decides. */
  contradictionsForTai: string[];
  /** Authority recommendations under the temporary manual policy. */
  authorityPolicy: AuthorityPolicy;
  graduationRecommendations: AuthorityRecommendation[];
  trainingDebt: TrainingDebtReport;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

function scopesOverlap(candidate: CandidatePrinciple, principle: Principle): boolean {
  if (candidate.scope.domain !== principle.scope.domain) return false;
  if (candidate.scope.contextTags.length === 0 || principle.scope.contextTags.length === 0) {
    return true;
  }
  return candidate.scope.contextTags.some((tag) => principle.scope.contextTags.includes(tag));
}

/** Word-overlap similarity, deterministic and explainable. */
function similar(left: string, right: string): boolean {
  const a = new Set(normalize(left).split(" "));
  const b = new Set(normalize(right).split(" "));
  if (a.size === 0 || b.size === 0) return false;
  let shared = 0;
  a.forEach((word) => {
    if (b.has(word)) shared += 1;
  });
  return shared / Math.min(a.size, b.size) >= 0.6;
}

function evidenceRefFor(unit: LearningUnit): EvidenceRef {
  return {
    unitId: unit.id,
    relationshipId: unit.relationshipId,
    contextTags: unit.context.contextTags,
    capturedAt: unit.assembledAt,
  };
}

let provisionalCounter = 0;

function newProvisionalPrinciple(entry: CandidateWithUnit, now: string): Principle {
  provisionalCounter += 1;
  return {
    id: `provisional:${now}:${provisionalCounter}`,
    organizationId: entry.unit.organizationId,
    principle: entry.candidate.principle,
    scope: entry.candidate.scope,
    status: "provisional",
    source: "inferred",
    confidence: entry.candidate.confidence,
    supportingEvidence: [evidenceRefFor(entry.unit)],
    contradictingEvidence: [],
    contextsObserved: [...entry.unit.context.contextTags],
    relationshipsObserved: entry.unit.relationshipId ? [entry.unit.relationshipId] : [],
    lastValidatedAt: now,
    supersededBy: null,
    transitionReason: null,
  };
}

/**
 * Cluster one candidate against the store. Three outcomes per spec:
 * reinforce, contradict (flag, never resolve), or genuinely new
 * (provisional). Deterministic: scope match + text similarity + the
 * reflection's own contradictsExisting reading.
 */
export function clusterCandidate(
  entry: CandidateWithUnit,
  store: Principle[],
): { relation: "reinforces" | "contradicts" | "new"; existing: Principle | null } {
  const named = entry.candidate.contradictsExisting
    ? store.find((principle) => principle.id === entry.candidate.contradictsExisting)
    : null;
  if (named && named.status !== "superseded" && named.status !== "retired") {
    return { relation: "contradicts", existing: named };
  }
  const match = store.find(
    (principle) =>
      principle.status !== "superseded" &&
      principle.status !== "retired" &&
      scopesOverlap(entry.candidate, principle) &&
      similar(entry.candidate.principle, principle.principle),
  );
  if (match) return { relation: "reinforces", existing: match };
  return { relation: "new", existing: null };
}

/** Aggregate training-debt reads per decision class, worst first. */
export function buildTrainingDebtReport(units: LearningUnit[]): TrainingDebtReport {
  const byClass = new Map<string, TrainingDebtItem>();
  let total = 0;
  for (const unit of units) {
    const debt = unit.reflection?.trainingDebt;
    const intervention = unit.dimensional?.tai_intervention;
    const needed = intervention && intervention !== "none";
    if (!needed) continue;
    total += 1;
    if (!debt) continue;
    const decisionClass = `${unit.context.decideAction ?? "unknown"}:${
      unit.context.contextTags[0] ?? unit.context.archetype ?? "general"
    }`;
    const existing = byClass.get(decisionClass);
    if (existing) {
      existing.occurrences += 1;
    } else {
      byClass.set(decisionClass, {
        decisionClass,
        occurrences: 1,
        whyTai: debt.whyTai,
        judgmentMissing: debt.judgmentMissing,
        learnable: debt.learnable,
        graduationEvidence: debt.graduationEvidence,
      });
    }
  }
  return {
    topDebtItems: [...byClass.values()].sort((a, b) => b.occurrences - a.occurrences).slice(0, 5),
    totalEscalationsAndApprovals: total,
  };
}

/**
 * The consolidation pass. Pure over its inputs: the caller reads the store
 * and the reflected units under RLS and persists what comes back.
 */
export function consolidate(input: {
  existingPrinciples: Principle[];
  candidates: CandidateWithUnit[];
  /** All units this pass saw, for the training-debt report. */
  units: LearningUnit[];
  /** Per decision class, the four-dimension summary already computed. */
  decisionClassSummaries: DecisionClassSummary[];
  now?: string;
}): ConsolidationResult {
  const now = input.now ?? new Date().toISOString();
  const store = new Map(input.existingPrinciples.map((principle) => [principle.id, principle]));
  const transitions: ConsolidationResult["transitions"] = [];
  const contradictionsForTai: string[] = [];
  const newProvisional: Principle[] = [];

  for (const entry of input.candidates) {
    const clustered = clusterCandidate(entry, [...store.values(), ...newProvisional]);
    if (clustered.relation === "reinforces" && clustered.existing) {
      const applied = applySupportingEvidence(clustered.existing, evidenceRefFor(entry.unit), now);
      if (store.has(clustered.existing.id)) {
        store.set(clustered.existing.id, applied.principle);
      } else {
        const index = newProvisional.findIndex((p) => p.id === clustered.existing!.id);
        if (index >= 0) newProvisional[index] = applied.principle;
      }
      if (applied.transition) {
        transitions.push({ principleId: clustered.existing.id, ...applied.transition });
      }
    } else if (clustered.relation === "contradicts" && clustered.existing) {
      const applied = applyContradictingEvidence(
        clustered.existing,
        evidenceRefFor(entry.unit),
        now,
      );
      store.set(clustered.existing.id, applied.principle);
      if (applied.transition) {
        transitions.push({ principleId: clustered.existing.id, ...applied.transition });
      }
      if (applied.flagForTai) contradictionsForTai.push(applied.flagForTai);
    } else {
      newProvisional.push(newProvisionalPrinciple(entry, now));
    }
  }

  const graduationRecommendations = input.decisionClassSummaries
    .map((summary) => recommendAuthority(summary))
    .filter((rec): rec is AuthorityRecommendation => rec !== null);

  return {
    principles: [...store.values()],
    newProvisional,
    transitions,
    contradictionsForTai,
    authorityPolicy: MANUAL_V1_POLICY,
    graduationRecommendations,
    trainingDebt: buildTrainingDebtReport(input.units),
  };
}

/** The principles retrieval may see: influence requires promotion. */
export function influencingPrinciples(store: Principle[]): Principle[] {
  return store.filter((principle) => INFLUENCING_STATUSES.includes(principle.status));
}
