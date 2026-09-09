/**
 * Shared signal attention (Canon 27: one read per subject).
 *
 * Pulse and Conductor both look at the same `Signal[]` produced by
 * `deriveSignals`. Before this module each of them decided independently how
 * urgent a signal was and which recurring patterns counted as work leaking
 * between rooms, so the same fact could be ranked or worded two different ways
 * on two surfaces.
 *
 * This is the single deterministic reading. It is governance, not
 * interpretation: written thresholds over an already observed number, no model
 * judgment and no new business state. Every surface projects this read; no
 * surface re-derives it.
 */

import type { PulseImpactLevel, PulseSeverity } from "@/domain/pulse";
import type { Signal, SignalCategory } from "@/domain/signals";

/** Categories where the work is a person's judgment rather than execution. */
export const JUDGMENT_CATEGORIES: SignalCategory[] = [
  "pipeline",
  "client_stewardship",
  "pattern",
  "stewardship",
];

/** Written thresholds, named once so both rooms cite the same numbers. */
export const ATTENTION_THRESHOLDS = {
  actNow: 85,
  decide: 60,
  evaluate: 55,
  watch: 35,
  highImpact: 80,
  mediumImpact: 50,
} as const;

/**
 * Attention level. Written rules only:
 *  - growth and anything quiet is information,
 *  - urgent execution or an overdue promise is Act now,
 *  - open judgment is Evaluate,
 *  - everything still moving is watched.
 */
export function severityOf(signal: Signal): PulseSeverity {
  if (signal.category === "growth") return "good_to_know";
  if (signal.urgency >= ATTENTION_THRESHOLDS.actNow) return "act_now";
  if (signal.urgency >= ATTENTION_THRESHOLDS.decide) {
    return JUDGMENT_CATEGORIES.includes(signal.category) ? "evaluate" : "act_now";
  }
  if (signal.urgency >= ATTENTION_THRESHOLDS.evaluate && JUDGMENT_CATEGORIES.includes(signal.category))
    return "evaluate";
  if (signal.urgency >= ATTENTION_THRESHOLDS.watch) return "watch_closely";
  return "good_to_know";
}

export function impactOf(signal: Signal): PulseImpactLevel {
  if (signal.urgency >= ATTENTION_THRESHOLDS.highImpact) return "high";
  if (signal.urgency >= ATTENTION_THRESHOLDS.mediumImpact) return "medium";
  return "low";
}

/**
 * The recurring patterns that mean work is being lost between rooms.
 *
 * Conductor narrates these as leaks. Named here so Pulse and Conductor cannot
 * drift into two different lists of what counts as work going missing.
 */
export const LEAK_PATTERN_KEYS: string[] = [
  "reply_debt",
  "unworked_opportunity",
  "promises_slipping",
];

export function isLeakPattern(patternKey: string): boolean {
  return LEAK_PATTERN_KEYS.includes(patternKey);
}
