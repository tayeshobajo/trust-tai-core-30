/**
 * Trust Tai OS, confidence and "why we think" contracts.
 *
 * Anywhere Scout states something, it must also be able to say how sure it is
 * and what that belief rests on. Confidence is derived, never typed in, and
 * evidence is always a real page, a named provider, or a person's decision.
 */

export type ConfidenceLevel = "high" | "moderate" | "low" | "unknown";

export const CONFIDENCE_LEVEL_LABEL: Record<ConfidenceLevel, string> = {
  high: "High confidence",
  moderate: "Moderate confidence",
  low: "Low confidence",
  unknown: "Not established",
};

/** What a claim rests on. A claim with no evidence cannot be high confidence. */
export interface EvidenceRef {
  label: string;
  /** Public page the claim was read from, when one exists. */
  url?: string;
  kind: "page" | "provider" | "human" | "computed";
}

export interface ConfidenceRead {
  level: ConfidenceLevel;
  /** One sentence: why we think this, in plain language. */
  because: string;
  evidence: EvidenceRef[];
}

/** Confidence can be lowered by context, never raised past its evidence. */
export function capConfidence(read: ConfidenceRead, cap: ConfidenceLevel): ConfidenceRead {
  const order: ConfidenceLevel[] = ["unknown", "low", "moderate", "high"];
  const level =
    order.indexOf(read.level) > order.indexOf(cap) ? cap : read.level;
  return { ...read, level };
}
