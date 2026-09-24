/**
 * Authority policy: SUPERVISED -> GRADUATED -> ESCALATED per decision class
 * (Step 5 Learning Engine, Tai's ruling 5, 2026-09-24).
 *
 * A decision class is message type x context archetype. Its authority state:
 *   SUPERVISED  every action passes a human before the world sees it.
 *   GRADUATED   the class earned autonomy inside its demonstrated competence.
 *   ESCALATED   the class regressed or was never safe; everything goes to Tai.
 *
 * V1 POLICY IS EXPLICITLY TEMPORARY. mode "manual_v1": the engine RECOMMENDS
 * state changes with evidence attached; a human authorizes every change. Per
 * Tai (2026-09-24): the destination is policy-driven graduation for
 * sufficiently low-risk classes with Tai-set thresholds. Tai must never
 * manually graduate the 137th routine decision class. Exceptions, not
 * traffic. When that destination ships it replaces MANUAL_V1_POLICY with a
 * threshold policy record; nothing in this module flips authority itself,
 * and it NEVER touches send authority (decideSend) in any mode.
 *
 * Pure: recommendations from passed-in dimension summaries only.
 */

export type AuthorityState = "supervised" | "graduated" | "escalated";

export interface AuthorityPolicy {
  mode: "manual_v1";
  /** The engine may recommend; only a human applies a state change. */
  engineMayApply: false;
  statedDestination: string;
  adoptedAt: string;
}

/** The one active policy record. Temporary by declaration, not by accident. */
export const MANUAL_V1_POLICY: AuthorityPolicy = {
  mode: "manual_v1",
  engineMayApply: false,
  statedDestination:
    "Policy-driven graduation for sufficiently low-risk decision classes, with Tai-set thresholds. Manual authorization of routine classes is training debt, not the design.",
  adoptedAt: "2026-09-24",
};

/** The four dimensions from accumulated dimensional records + outcomes. */
export interface DecisionClassSummary {
  /** message type x context archetype, e.g. "congratulate:milestone_event". */
  decisionClass: string;
  currentState: AuthorityState;
  observations: number;
  voice: { gatePassRate: number; voiceEditDensity: number };
  truth: { violations: number; factualCorrections: number };
  judgment: { reversedByTai: number; confirmedByTai: number };
  outcome: { replies: number; positiveProgressions: number; silences: number; negativeSignals: number };
}

export interface AuthorityRecommendation {
  decisionClass: string;
  from: AuthorityState;
  to: AuthorityState;
  evidence: string[];
  /** Always true under manual_v1: a human flips the state, never the engine. */
  requiresHumanAuthorization: true;
}

const MIN_OBSERVATIONS = 5;

/**
 * Recommend an authority change for one decision class, or null when the
 * evidence supports staying put. Recommendations only; the policy record
 * says who may apply them.
 */
export function recommendAuthority(
  summary: DecisionClassSummary,
): AuthorityRecommendation | null {
  const evidence: string[] = [];
  const confirmations = summary.judgment.confirmedByTai;
  const reversals = summary.judgment.reversedByTai;
  const truthClean = summary.truth.violations === 0 && summary.truth.factualCorrections === 0;
  const voiceClean = summary.voice.gatePassRate >= 0.9 && summary.voice.voiceEditDensity <= 0.1;
  const outcomesHealthy =
    summary.outcome.negativeSignals === 0 &&
    summary.outcome.replies + summary.outcome.positiveProgressions >= summary.outcome.silences * 0.2;

  /* Regression first: a graduated class that starts costing truth or trust
     comes back under supervision, or escalates when the damage is factual. */
  if (summary.currentState === "graduated") {
    if (summary.truth.violations > 0 || summary.outcome.negativeSignals > 1) {
      evidence.push(
        `Truth violations: ${summary.truth.violations}; negative signals: ${summary.outcome.negativeSignals}.`,
      );
      return {
        decisionClass: summary.decisionClass,
        from: "graduated",
        to: "escalated",
        evidence,
        requiresHumanAuthorization: true,
      };
    }
    if (reversals > confirmations) {
      evidence.push(`Tai reversed ${reversals} verdicts against ${confirmations} confirmations.`);
      return {
        decisionClass: summary.decisionClass,
        from: "graduated",
        to: "supervised",
        evidence,
        requiresHumanAuthorization: true,
      };
    }
    return null;
  }

  if (summary.currentState === "escalated") {
    /* An escalated class only comes back through supervision, never straight
       to autonomy, and only after clean supervised evidence. */
    if (summary.observations >= MIN_OBSERVATIONS && truthClean && reversals === 0) {
      evidence.push(
        `${summary.observations} supervised observations with no truth issues and no reversals.`,
      );
      return {
        decisionClass: summary.decisionClass,
        from: "escalated",
        to: "supervised",
        evidence,
        requiresHumanAuthorization: true,
      };
    }
    return null;
  }

  /* Supervised -> graduated: all four dimensions must carry it. */
  if (
    summary.observations >= MIN_OBSERVATIONS &&
    voiceClean &&
    truthClean &&
    reversals === 0 &&
    confirmations >= MIN_OBSERVATIONS &&
    outcomesHealthy
  ) {
    evidence.push(
      `Voice: ${(summary.voice.gatePassRate * 100).toFixed(0)}% gate pass, edit density ${summary.voice.voiceEditDensity}.`,
      "Truth: no violations, no factual corrections.",
      `Judgment: ${confirmations} confirmations, 0 reversals (approved_unedited and un-overridden no-action both count).`,
      `Outcome: ${summary.outcome.replies} replies, ${summary.outcome.positiveProgressions} progressions, ${summary.outcome.negativeSignals} negative signals.`,
    );
    return {
      decisionClass: summary.decisionClass,
      from: "supervised",
      to: "graduated",
      evidence,
      requiresHumanAuthorization: true,
    };
  }

  return null;
}
