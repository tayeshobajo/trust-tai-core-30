/**
 * Scout, signal ranking.
 *
 * Two evidence sources already exist: the plain `signals` recorded on a
 * candidate, and the dated `buyingSignals` collected by intel. This unifies
 * them into one ranked read model and, for the Overview, returns a small,
 * type-diverse set so the page never shows five versions of the same fact.
 *
 * Ranking is deterministic: strength, then recency, then confidence.
 */

import type { ProspectCandidate } from "@/domain/scout";

export type SignalStrength = "strong" | "medium" | "weak";

export interface RankedSignal {
  id: string;
  /** e.g. "hiring", "funding", "leadership_change", "observation". */
  type: string;
  title: string;
  explanation: string;
  strength: SignalStrength;
  confidence: "observed" | "inferred";
  observedAt?: string;
  sourceUrl?: string;
  /** Where the evidence came from, in plain language. */
  source: string;
}

const TYPE_LABEL: Record<string, string> = {
  hiring: "Hiring growth",
  funding: "Funding",
  expansion: "Expansion",
  rebrand: "Rebrand",
  leadership_change: "Leadership change",
  technology: "Technology adoption",
  product: "Product launch",
  partnership: "Partnership",
  award: "Recognition",
  observation: "Observed on site",
};

export function signalTypeLabel(type: string): string {
  return (
    TYPE_LABEL[type] ??
    type
      .replace(/_/g, " ")
      .replace(/^\w/, (c) => c.toUpperCase())
  );
}

const DAY = 24 * 60 * 60 * 1000;

function ageDays(observedAt: string | undefined, now: number): number | null {
  if (!observedAt) return null;
  const at = Date.parse(observedAt);
  if (Number.isNaN(at)) return null;
  return Math.max(0, (now - at) / DAY);
}

function strengthOf(hasSource: boolean, age: number | null): SignalStrength {
  if (hasSource && age !== null && age <= 90) return "strong";
  if (hasSource) return "medium";
  if (age !== null && age <= 90) return "medium";
  return "weak";
}

const STRENGTH_RANK: Record<SignalStrength, number> = { strong: 3, medium: 2, weak: 1 };

/** Every signal Scout holds for this company, strongest first. */
export function rankScoutSignals(
  candidate: ProspectCandidate,
  now: number = Date.now(),
): RankedSignal[] {
  const ranked: RankedSignal[] = [];

  for (const buying of candidate.intel?.buyingSignals ?? []) {
    const age = ageDays(buying.observedAt, now);
    ranked.push({
      id: `buying:${buying.type}:${buying.statement.slice(0, 40)}`,
      type: buying.type || "observation",
      title: signalTypeLabel(buying.type || "observation"),
      explanation: buying.statement,
      strength: strengthOf(Boolean(buying.sourceUrl), age),
      confidence: buying.sourceUrl ? "observed" : "inferred",
      ...(buying.observedAt ? { observedAt: buying.observedAt } : {}),
      ...(buying.sourceUrl ? { sourceUrl: buying.sourceUrl } : {}),
      source: buying.sourceUrl ? "Public page" : "Scout research",
    });
  }

  for (const signal of candidate.signals ?? []) {
    const observedAt = signal.provenance?.observedAt;
    const age = ageDays(observedAt, now);
    ranked.push({
      id: `signal:${signal.id}`,
      type: "observation",
      title: signalTypeLabel("observation"),
      explanation: signal.statement,
      strength: strengthOf(Boolean(signal.sourceUrl), age),
      confidence: signal.provenance?.confidence === "inferred" ? "inferred" : "observed",
      ...(observedAt ? { observedAt } : {}),
      ...(signal.sourceUrl ? { sourceUrl: signal.sourceUrl } : {}),
      source: signal.sourceUrl ? "Public page" : "Scout research",
    });
  }

  return ranked.sort((a, b) => {
    const byStrength = STRENGTH_RANK[b.strength] - STRENGTH_RANK[a.strength];
    if (byStrength !== 0) return byStrength;
    const ageA = ageDays(a.observedAt, now) ?? Number.MAX_SAFE_INTEGER;
    const ageB = ageDays(b.observedAt, now) ?? Number.MAX_SAFE_INTEGER;
    if (ageA !== ageB) return ageA - ageB;
    if (a.confidence !== b.confidence) return a.confidence === "observed" ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/**
 * A bounded, type-diverse set for the Overview. One per type first; only when
 * types run out does a second signal of the same type get a place.
 */
export function topScoutSignals(
  candidate: ProspectCandidate,
  limit = 4,
  now: number = Date.now(),
): RankedSignal[] {
  const ranked = rankScoutSignals(candidate, now);
  const seen = new Set<string>();
  const picked: RankedSignal[] = [];

  for (const signal of ranked) {
    if (picked.length >= limit) break;
    if (seen.has(signal.type)) continue;
    seen.add(signal.type);
    picked.push(signal);
  }
  for (const signal of ranked) {
    if (picked.length >= limit) break;
    if (picked.includes(signal)) continue;
    picked.push(signal);
  }
  return picked;
}
