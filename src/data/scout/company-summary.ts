/**
 * Scout — derived company summary.
 *
 * Scout's judgment about one company, expressed in plain language and derived
 * from state that already exists: the deterministic fit evaluation and the
 * ranked signals. No second source of truth is stored anywhere.
 */

import type { ProspectCandidate } from "@/domain/scout";

import { readIcpFactors } from "./icp-factors";
import { rankScoutSignals } from "./top-signals";

export type Potential = "high" | "medium" | "low" | "unknown";

export interface ScoutCompanySummary {
  companyId: string;
  headline: string;
  summary: string;
  topReasons: string[];
  /** 0–100 ICP match, or null when the company cannot honestly be scored. */
  icpMatch: number | null;
  score: number | null;
  potential: Potential;
  confidence: "high" | "medium" | "low";
  computedAt: string;
}

export const POTENTIAL_LABEL: Record<Potential, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
  unknown: "Not known yet",
};

function potentialOf(score: number | null, strongSignals: number): Potential {
  if (score === null) return "unknown";
  if (score >= 75 || (score >= 60 && strongSignals >= 2)) return "high";
  if (score >= 45) return "medium";
  return "low";
}

export function buildScoutCompanySummary(
  candidate: ProspectCandidate,
  now: number = Date.now(),
): ScoutCompanySummary {
  const { prospect, evaluation } = candidate;
  const factors = readIcpFactors(evaluation);
  const signals = rankScoutSignals(candidate, now);
  const strong = signals.filter((s) => s.strength === "strong");
  const score = evaluation.scoreable ? evaluation.score : null;
  const potential = potentialOf(score, strong.length);

  const reasons: string[] = [];
  if (factors.matched > 0) {
    reasons.push(`Strong fit across ${factors.matched} ICP ${factors.matched === 1 ? "factor" : "factors"}`);
  }
  for (const signal of strong.slice(0, 2)) {
    reasons.push(`${signal.title}: ${signal.explanation}`);
  }
  if (reasons.length < 4 && evaluation.strongestSignal) {
    reasons.push(evaluation.strongestSignal);
  }
  if (reasons.length < 4 && (candidate.intel?.opportunities?.length ?? 0) > 0) {
    const first = candidate.intel?.opportunities?.[0];
    if (first) reasons.push(first.statement);
  }

  const headline =
    score === null
      ? `${prospect.name} has not been researched against the ICP yet`
      : potential === "high"
        ? `${prospect.name} looks like a strong fit`
        : potential === "medium"
          ? `${prospect.name} is a partial fit worth a look`
          : `${prospect.name} is a weak fit on current evidence`;

  const summary =
    score === null
      ? "Scout has no researched evidence for this company yet, so no ICP judgment has been made. Run research to score it honestly."
      : `${evaluation.explanation} ${
          strong.length > 0
            ? `${strong.length} strong ${strong.length === 1 ? "signal" : "signals"} back this up.`
            : "No strong dated signals are on record yet."
        }`.trim();

  const confidence =
    score === null || evaluation.evidenceCount === 0
      ? "low"
      : evaluation.evidenceCount >= 5 && strong.length > 0
        ? "high"
        : "medium";

  return {
    companyId: prospect.id,
    headline,
    summary,
    topReasons: reasons.slice(0, 4),
    icpMatch: score,
    score,
    potential,
    confidence,
    computedAt: new Date(now).toISOString(),
  };
}
