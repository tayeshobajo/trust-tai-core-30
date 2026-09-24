/**
 * Scout, the opportunity gap read.
 *
 * Pure and dependency-free. It answers one question from evidence that is
 * already stored: is this a healthy business in motion whose digital presence
 * has fallen behind? That distance, momentum minus digital maturity, is the
 * opportunity Trust Tai actually sells into.
 *
 * The read never guesses. Each level requires positive evidence on both sides:
 *  - "high"    needs strong momentum AND clearly weak digital presence.
 *  - "medium"  needs at least one read on each side, but not both strong.
 *  - "low"     needs positive evidence the digital presence is already strong
 *              (or in-house capability exists) with no observed weakness.
 *  - "unknown" is everything else. Missing evidence stays missing.
 */

import type { OpportunityGapRead } from "@/domain/scout-fit";

type Row = Record<string, unknown>;

export interface OpportunityGapInput {
  /** Evidence the business is healthy and moving: buying signals, live activity, proof. */
  momentumEvidence: string[];
  /** Evidence the digital presence is weak: observed problems, confident gaps. */
  weaknessEvidence: string[];
  /** Positive evidence the digital presence is strong or in-house capability exists. */
  healthEvidence: string[];
}

function dedupe(items: string[]): string[] {
  return Array.from(new Set(items.map((item) => item.trim()).filter(Boolean)));
}

export function deriveOpportunityGap(input: OpportunityGapInput): OpportunityGapRead {
  const momentum = dedupe(input.momentumEvidence);
  const weakness = dedupe(input.weaknessEvidence);
  const health = dedupe(input.healthEvidence);

  // Positive evidence of digital strength wins over gap-hunting: a company
  // that can already build for itself has no gap worth selling into.
  if (health.length > 0 && weakness.length === 0) {
    return { gap: "low", momentumEvidence: momentum, maturityEvidence: health };
  }
  if (health.length > 0 && weakness.length > 0) {
    // Contradictory reads: strong in places, weak in others. Held at medium
    // rather than resolved by guesswork.
    return {
      gap: "medium",
      momentumEvidence: momentum,
      maturityEvidence: [...weakness, ...health],
    };
  }
  if (momentum.length >= 2 && weakness.length >= 2) {
    return { gap: "high", momentumEvidence: momentum, maturityEvidence: weakness };
  }
  if (momentum.length >= 1 && weakness.length >= 1) {
    return { gap: "medium", momentumEvidence: momentum, maturityEvidence: weakness };
  }
  return { gap: "unknown", momentumEvidence: momentum, maturityEvidence: weakness };
}

/** Statement text from a model-returned signal row, or empty when absent. */
function statementOf(entry: unknown): string {
  if (typeof entry === "string") return entry.trim();
  if (!entry || typeof entry !== "object") return "";
  const row = entry as Row;
  const text = row["statement"] ?? row["signal"] ?? row["summary"] ?? row["issue"];
  return typeof text === "string" ? text.trim() : "";
}

/** Statements from a stored signal array, tolerant of shape drift. */
export function signalStatements(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return dedupe(value.map(statementOf));
}

/**
 * The stored `metadata.scout_intel` arrays the gap read consumes, when a row
 * has them. Older rows simply have nothing here, which reads as unknown.
 */
export function gapIntelFromMetadata(metadata: unknown): {
  buying_signals?: unknown;
  opportunities?: unknown;
} | null {
  if (!metadata || typeof metadata !== "object") return null;
  const block = (metadata as Row)["scout_intel"];
  if (!block || typeof block !== "object") return null;
  const intel = block as Row;
  return { buying_signals: intel["buying_signals"], opportunities: intel["opportunities"] };
}
