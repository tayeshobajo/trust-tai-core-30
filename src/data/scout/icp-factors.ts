/**
 * Scout, ICP factor read model.
 *
 * A normalized, presentation-ready view over the deterministic fit criteria
 * already produced by the evaluator. Nothing is re-scored here and nothing is
 * inferred: this only renames states into the four the detail page shows, and
 * keeps `unknown` firmly apart from `not matched`.
 */

import type { FitCriterion, ScoutFitEvaluation } from "@/domain/scout-fit";

export type ICPFactorStatus = "matched" | "partial" | "not_matched" | "unknown";

export interface ICPFactorResult {
  factorKey: string;
  label: string;
  status: ICPFactorStatus;
  /** Short human value, e.g. "Financial Services". Absent when unknown. */
  value?: string;
  scoreContribution: number;
  maxContribution: number;
  confidence: "observed" | "inferred" | "unknown";
  reason: string;
  evidence: string[];
}

export interface ICPFactorView {
  factors: ICPFactorResult[];
  /** How many factors are met outright. */
  matched: number;
  /** Met or partially met. */
  aligned: number;
  total: number;
  scoreable: boolean;
  /** e.g. "8 of 10 factors met". */
  headline: string;
}

const STATUS: Record<FitCriterion["state"], ICPFactorStatus> = {
  met: "matched",
  partial: "partial",
  mismatch: "not_matched",
  missing: "unknown",
};

export const ICP_STATUS_LABEL: Record<ICPFactorStatus, string> = {
  matched: "Met",
  partial: "Partly met",
  not_matched: "Not met",
  unknown: "Not known yet",
};

/** First short clause of the reason, used as the factor's value line. */
function valueOf(criterion: FitCriterion): string | undefined {
  if (criterion.state === "missing") return undefined;
  const raw = (criterion.reason ?? "").trim();
  if (!raw) return undefined;
  const clause = raw.split(/[.·, ]|\s-\s/)[0]?.trim() ?? "";
  if (!clause) return undefined;
  return clause.length > 64 ? `${clause.slice(0, 61)}…` : clause;
}

export function readIcpFactors(evaluation: ScoutFitEvaluation): ICPFactorView {
  const factors: ICPFactorResult[] = (evaluation.criteria ?? []).map((criterion) => {
    const status = STATUS[criterion.state];
    const value = valueOf(criterion);
    return {
      factorKey: criterion.key,
      label: criterion.label,
      status,
      ...(value ? { value } : {}),
      scoreContribution: criterion.score,
      maxContribution: criterion.maxScore,
      confidence:
        status === "unknown"
          ? "unknown"
          : (criterion.sourceUrls?.length ?? 0) > 0
            ? "observed"
            : "inferred",
      reason: criterion.reason,
      evidence: criterion.sourceUrls ?? [],
    };
  });

  const matched = factors.filter((f) => f.status === "matched").length;
  const aligned = matched + factors.filter((f) => f.status === "partial").length;

  return {
    factors,
    matched,
    aligned,
    total: factors.length,
    scoreable: evaluation.scoreable,
    headline:
      factors.length === 0
        ? "No ICP factors evaluated yet"
        : `${matched} of ${factors.length} factors met`,
  };
}
