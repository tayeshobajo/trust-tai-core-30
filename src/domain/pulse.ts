/**
 * Pulse, the visibility read model.
 *
 * Pulse owns no business truth. A `PulseSignal` is a presentation projection of
 * a derived `Signal`: the same fact, sorted into one of four attention levels
 * with the owning room's own action attached. Every field here must be
 * explainable from evidence the suite already holds.
 */

import type { ConfidenceLevel, EvidenceRef } from "./confidence";
import type { EntityRef, ID, ISODateTime } from "./entities";
import type { SignalCategory } from "./signals";

/** Four attention levels. Colour always means one of these, never decoration. */
export type PulseSeverity = "act_now" | "evaluate" | "watch_closely" | "good_to_know";

export const PULSE_SEVERITY_ORDER: PulseSeverity[] = [
  "act_now",
  "evaluate",
  "watch_closely",
  "good_to_know",
];

export const PULSE_SEVERITY_LABEL: Record<PulseSeverity, string> = {
  act_now: "Act now",
  evaluate: "Evaluate",
  watch_closely: "Watch closely",
  good_to_know: "Good to know",
};

/** What each level means, said plainly. Shown in the "why am I seeing this" panel. */
export const PULSE_SEVERITY_MEANING: Record<PulseSeverity, string> = {
  act_now: "Something important is blocked, overdue, or stopping progress.",
  evaluate: "A decision or judgment is needed from a person.",
  watch_closely: "Nothing to do yet, but this could become important.",
  good_to_know: "Useful context that does not require action.",
};

export type PulseImpactLevel = "high" | "medium" | "low";

export const PULSE_IMPACT_LABEL: Record<PulseImpactLevel, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Where attention is accumulating. Derived from the signal's category. */
export type PulseArea = "delivery" | "decisions" | "outreach" | "opportunities" | "stewardship";

export const PULSE_AREA_LABEL: Record<PulseArea, string> = {
  delivery: "Delivery",
  decisions: "Decisions",
  outreach: "Outreach",
  opportunities: "Opportunities",
  stewardship: "Stewardship",
};

export interface PulseSignal {
  id: ID;
  organizationId: ID;
  severity: PulseSeverity;
  category: SignalCategory;
  area: PulseArea;
  title: string;
  /** One sentence. Never more. */
  summary: string;
  /** Why this is on screen at all, in a person's language. */
  reason: string;
  /** The room that owns the change, e.g. "projects". */
  sourceApp: string;
  sourceAppLabel: string;
  /** Human lineage, e.g. "Spartan Security › Houston Security Search Visibility". */
  entityPath: string;
  /** The shared entity the signal is about, when there is one. */
  subject?: EntityRef;
  impact: PulseImpactLevel;
  /** Whole days since the underlying fact was observed. */
  ageDays: number;
  dueAt?: ISODateTime;
  /** The owning room's own verb, e.g. "Resolve blocker". Never generic. */
  actionLabel: string;
  actionRoute: string;
  evidence: EvidenceRef[];
  confidence: ConfidenceLevel;
  at: ISODateTime;
}

/* -------------------------------------------------------------- feedback */

/**
 * Lightweight teaching. None of these change business truth: they change how
 * prominently Pulse frames a signal for this organization.
 */
export type PulseFeedbackKind = "accepted" | "not_now" | "not_useful";

export const PULSE_FEEDBACK_LABEL: Record<PulseFeedbackKind, string> = {
  accepted: "Accept",
  not_now: "Not now",
  not_useful: "Not useful",
};

export const PULSE_FEEDBACK_MEANING: Record<PulseFeedbackKind, string> = {
  accepted: "This deserves attention.",
  not_now: "Keep it, but do not surface it prominently right now.",
  not_useful: "This framing was not useful.",
};

export interface PulseFeedback {
  signalId: ID;
  /** The rule family the signal came from, so learning is about kinds, not rows. */
  signalKind: string;
  kind: PulseFeedbackKind;
  at: ISODateTime;
}

/** How long "Not now" holds a signal back before it returns at full weight. */
export const NOT_NOW_DAYS = 7;

/** Repeated dismissals of the same rule family before Pulse quiets it. */
export const NOT_USEFUL_THRESHOLD = 3;

/**
 * The rule family a signal id belongs to. Ids are built as colon-separated
 * segments (`comms:reply-debt:<uuid>`), so the leading non-id segments name
 * the rule. Learning is applied to the family, never to one row.
 */
export function signalKindOf(signalId: string): string {
  const segments = signalId.split(":").filter(Boolean);
  const named = segments.filter((part) => !/^[0-9a-f-]{8,}$/i.test(part));
  return (named.length > 0 ? named : segments).slice(0, 2).join(":") || signalId;
}
