/**
 * DECIDE: before anything is written, predict what Tai would DO.
 *
 * Pure and deterministic, Phase A. No model call: the vocabulary and the
 * rules below are code, so every verdict is explainable line by line and
 * testable in a table. A Phase B judgment layer may refine confidence and
 * handle situations these rules escalate; it never widens write authority.
 *
 * Laws encoded here:
 *  - NO ACTION is a first-class successful outcome. `wait` and `do_nothing`
 *    return outcome "success_no_action"; downstream counts them as wins.
 *  - An unanswered outbound is never chased. The verdict is `wait`.
 *  - An inbound reply is a human's to answer in Phase A: `escalate_to_tai`.
 *  - No interaction is optimized for MRR; the rules read evidence, momentum
 *    and the relationship's actual state, never revenue.
 */

import type { OpportunityGapLevel, FitLight } from "@/domain/scout-fit";
import type { WorldCard } from "@/domain/world-card";
import { unknownsDominate, worldCardEvidenceCount } from "@/domain/world-card";

export type DecideActionName =
  | "observe"
  | "wait"
  | "research_deeper"
  | "congratulate"
  | "connect"
  | "ask"
  | "help"
  | "introduce"
  | "send_value"
  | "begin_conversation"
  | "follow_thread"
  | "escalate_to_tai"
  | "do_nothing";

/** Actions that intend to put words in front of the prospect. */
export const WRITE_ACTIONS: readonly DecideActionName[] = [
  "congratulate",
  "connect",
  "ask",
  "help",
  "introduce",
  "send_value",
  "begin_conversation",
  "follow_thread",
];

export function isWriteAction(action: DecideActionName): boolean {
  return WRITE_ACTIONS.includes(action);
}

/**
 * The outcome class of a verdict. "success_no_action" is a win, not a
 * failure: the system looked, understood, and correctly chose silence.
 */
export type DecideOutcome = "success_no_action" | "write_intended" | "escalated";

export interface DecideEscalationRead {
  /** How unfamiliar this situation is to the encoded rules, 0..1. */
  novelty: number;
  /** How costly a wrong move would be, 0..1. */
  consequence: number;
  /** How much the evidence underdetermines the choice, 0..1. */
  ambiguity: number;
}

export interface DecideHistoryFacts {
  /** Relationship stage when one exists, else null. */
  stage: string | null;
  priorOutboundCount: number;
  priorInboundCount: number;
  daysSinceLastOutbound: number | null;
  daysSinceLastInbound: number | null;
  /** An outbound sits at the end of the thread with no reply. */
  hasUnansweredOutbound: boolean;
  /** An inbound sits at the end of the thread awaiting an answer. */
  hasOpenInbound: boolean;
}

export interface DecideInput {
  worldCard: WorldCard;
  fit: { light: FitLight; score: number; scoreable: boolean };
  gap: OpportunityGapLevel;
  contact: { verifiedOwnerEmail: boolean; anyEmailRoute: boolean };
  history: DecideHistoryFacts;
}

export interface DecideVerdict {
  action: DecideActionName;
  outcome: DecideOutcome;
  /** One line per load-bearing piece of evidence behind the verdict. */
  rationale: string[];
  confidence: number;
  escalation: DecideEscalationRead;
  writeIntended: boolean;
}

/** Stages where a scripted first-touch rule set has no business acting. */
const HUMAN_LED_STAGES = new Set(["in_conversation", "meeting_set", "opportunity", "client"]);

const ESCALATION_THRESHOLD = 0.7;
const LOW_CONFIDENCE_FLOOR = 0.4;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function verdict(
  action: DecideActionName,
  rationale: string[],
  confidence: number,
  escalation: DecideEscalationRead,
): DecideVerdict {
  const writeIntended = isWriteAction(action);
  const outcome: DecideOutcome =
    action === "escalate_to_tai"
      ? "escalated"
      : writeIntended
        ? "write_intended"
        : "success_no_action";
  return {
    action,
    outcome,
    rationale,
    confidence: clamp01(confidence),
    escalation,
    writeIntended,
  };
}

function escalationRead(input: DecideInput): DecideEscalationRead {
  const { worldCard, history, fit } = input;
  const evidenceCount = worldCardEvidenceCount(worldCard);
  const ambiguity = clamp01(
    worldCard.unknowns.length / Math.max(1, worldCard.unknowns.length + evidenceCount),
  );
  /* Novelty: the rules were written for cold or early relationships. A
     graduated stage, or history the rules cannot read, is unfamiliar. */
  const novelty = clamp01(
    (history.stage && HUMAN_LED_STAGES.has(history.stage) ? 0.8 : 0.1) +
      (history.priorInboundCount > 0 ? 0.2 : 0),
  );
  /* Consequence: writing to a real person is never free; a mismatch or an
     already-warm thread raises the cost of a wrong move. */
  const consequence = clamp01(
    0.3 +
      (history.priorOutboundCount > 0 ? 0.1 : 0) +
      (history.priorInboundCount > 0 ? 0.2 : 0) +
      (fit.light === "red" ? 0.2 : 0),
  );
  return { novelty, consequence, ambiguity };
}

/**
 * Deterministic Phase A rules, evaluated in priority order. The first rule
 * whose facts hold wins; later rules never see the case.
 */
export function decideAction(input: DecideInput): DecideVerdict {
  const { worldCard, fit, gap, contact, history } = input;
  const escalation = escalationRead(input);
  const evidenceCount = worldCardEvidenceCount(worldCard);

  /* 1. A reply is on the table. Phase A keeps replies human, always. */
  if (history.hasOpenInbound) {
    return verdict(
      "escalate_to_tai",
      [
        "An inbound message is waiting at the end of the thread.",
        "Phase A rule: replies are answered by Tai, never by the engine.",
      ],
      0.95,
      escalation,
    );
  }

  /* 2. We spoke last and heard nothing. Silence is theirs to break. */
  if (history.hasUnansweredOutbound) {
    return verdict(
      "wait",
      [
        `The last outbound has had no reply${
          history.daysSinceLastOutbound !== null
            ? ` for ${history.daysSinceLastOutbound} day(s)`
            : ""
        }.`,
        "Rule: an unanswered outbound is never chased. Waiting is the correct move and counts as a success.",
      ],
      0.9,
      escalation,
    );
  }

  /* 3. A live human-led relationship is not this rule set's territory. */
  if (history.stage && HUMAN_LED_STAGES.has(history.stage)) {
    return verdict(
      "escalate_to_tai",
      [
        `The relationship stage is "${history.stage}", which a human is already leading.`,
        "Rule: the engine never acts inside a live human-led relationship.",
      ],
      0.9,
      escalation,
    );
  }

  /* 4. Positive evidence of a mismatch. Correctly doing nothing is a win. */
  if (fit.light === "red") {
    return verdict(
      "do_nothing",
      [
        `Fit is red at score ${fit.score}: positive evidence of a mismatch is on record.`,
        "Rule: no interaction is ever optimized for revenue; a mismatch is left alone.",
      ],
      0.85,
      escalation,
    );
  }

  /* 5. Nothing has been read yet: watch, do not guess. */
  if (!fit.scoreable || evidenceCount === 0) {
    return verdict(
      "observe",
      [
        fit.scoreable
          ? "The World Card holds no evidence-backed entries yet."
          : "The prospect has never been researched, so no honest read exists.",
        "Rule: with nothing observed, the engine observes. It never invents a reason to write.",
      ],
      0.8,
      escalation,
    );
  }

  /* 6. Promising but under-known: the next move is research, not outreach. */
  if ((fit.light === "green" || fit.light === "yellow") && unknownsDominate(worldCard)) {
    return verdict(
      "research_deeper",
      [
        `Fit reads ${fit.light}, but ${worldCard.unknowns.length} unknown(s) outweigh ${evidenceCount} evidenced entr(ies).`,
        "Rule: when unknowns dominate a promising read, deepen the research before anyone is written to.",
      ],
      0.75,
      escalation,
    );
  }

  /* 7. The begin_conversation gate: every condition, or no first touch. */
  if (
    fit.light === "green" &&
    gap === "high" &&
    contact.verifiedOwnerEmail &&
    history.priorOutboundCount === 0 &&
    worldCard.whyTrustTai.length > 0
  ) {
    const candidate = verdict(
      "begin_conversation",
      [
        `Fit is green at score ${fit.score}.`,
        "The opportunity gap reads high: momentum with a digital presence that has fallen behind.",
        "A decision maker has a verified email route.",
        "No prior outbound exists; a first conversation would be genuinely first.",
        `Evidenced reason to talk: ${worldCard.whyTrustTai[0]}`,
      ],
      0.8,
      escalation,
    );
    return maybeEscalate(candidate);
  }

  /* 8. A fresh observed change on an already-open, unblocked thread. */
  if (
    worldCard.recentChanges.length > 0 &&
    history.priorOutboundCount > 0 &&
    history.priorInboundCount > 0
  ) {
    const candidate = verdict(
      "congratulate",
      [
        `A recent change was observed: ${worldCard.recentChanges[0]}`,
        "The thread is open in both directions with nothing unanswered, so a light congratulation fits.",
      ],
      0.6,
      escalation,
    );
    return maybeEscalate(candidate);
  }

  /* 9. Real promise, no verified route yet: research the route, not around it. */
  if (fit.light === "green" && (gap === "high" || gap === "medium") && !contact.verifiedOwnerEmail) {
    return verdict(
      "research_deeper",
      [
        `Fit is green and the gap reads ${gap}, but no verified decision-maker email exists.`,
        "Rule: a first conversation waits for a verified route; guessing at addresses is not outreach.",
      ],
      0.7,
      escalation,
    );
  }

  /* 10. Nothing moved and no gap is evidenced. Silence is the right answer. */
  if (worldCard.recentChanges.length === 0 && (gap === "unknown" || gap === "low")) {
    return verdict(
      "do_nothing",
      [
        "No meaningful change has been observed.",
        `The opportunity gap reads ${gap}: no evidenced reason to reach out exists.`,
        "Doing nothing here is the correct outcome, not a miss.",
      ],
      0.8,
      escalation,
    );
  }

  /* 11. Everything else: keep watching. The rules do not force a move. */
  return verdict(
    "observe",
    [
      `Fit reads ${fit.light} with gap ${gap}; the evidence supports attention, not action.`,
      "Rule: when no rule clearly fires, the engine watches rather than improvises.",
    ],
    0.55,
    escalation,
  );
}

/**
 * A writing verdict must survive the escalation read. High novelty,
 * consequence or ambiguity, or low confidence, hands the case to Tai
 * instead of writing. Non-writing verdicts are already safe and pass
 * through untouched.
 */
function maybeEscalate(candidate: DecideVerdict): DecideVerdict {
  if (!candidate.writeIntended) return candidate;
  const { novelty, consequence, ambiguity } = candidate.escalation;
  const over =
    novelty >= ESCALATION_THRESHOLD ||
    consequence >= ESCALATION_THRESHOLD ||
    ambiguity >= ESCALATION_THRESHOLD;
  if (!over && candidate.confidence >= LOW_CONFIDENCE_FLOOR) return candidate;
  return {
    ...candidate,
    action: "escalate_to_tai",
    outcome: "escalated",
    writeIntended: false,
    rationale: [
      ...candidate.rationale,
      over
        ? `Escalated: novelty ${novelty.toFixed(2)}, consequence ${consequence.toFixed(2)}, ambiguity ${ambiguity.toFixed(2)} crossed the ${ESCALATION_THRESHOLD} threshold.`
        : `Escalated: confidence ${candidate.confidence.toFixed(2)} is below the ${LOW_CONFIDENCE_FLOOR} floor for writing.`,
    ],
  };
}

/**
 * The one question the draft path asks: may words be written at all?
 * Everything that is not an explicit writing verdict refuses the draft.
 */
export function shouldDraft(v: DecideVerdict): boolean {
  return v.writeIntended && v.outcome === "write_intended";
}

export interface TouchFact {
  direction: "inbound" | "outbound";
  occurredAt: string;
}

/**
 * Derive the history facts DECIDE needs from a relationship's touches.
 * The newest touch settles who spoke last: an inbound at the end of the
 * thread is an open reply, an outbound at the end is unanswered.
 */
export function historyFromTouches(
  stage: string | null,
  touches: TouchFact[],
  now: Date = new Date(),
): DecideHistoryFacts {
  const ordered = [...touches].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
  const latest = ordered[0] ?? null;
  const daysSince = (iso: string | undefined): number | null => {
    if (!iso) return null;
    const at = Date.parse(iso);
    if (Number.isNaN(at)) return null;
    return Math.max(0, Math.round((now.getTime() - at) / 86_400_000));
  };
  const lastOutbound = ordered.find((touch) => touch.direction === "outbound");
  const lastInbound = ordered.find((touch) => touch.direction === "inbound");
  return {
    stage,
    priorOutboundCount: ordered.filter((touch) => touch.direction === "outbound").length,
    priorInboundCount: ordered.filter((touch) => touch.direction === "inbound").length,
    daysSinceLastOutbound: daysSince(lastOutbound?.occurredAt),
    daysSinceLastInbound: daysSince(lastInbound?.occurredAt),
    hasUnansweredOutbound: latest?.direction === "outbound",
    hasOpenInbound: latest?.direction === "inbound",
  };
}

/** Serialized verdict for activities payloads and draft rationale. */
export function decideVerdictForStorage(v: DecideVerdict): Record<string, unknown> {
  return {
    action: v.action,
    outcome: v.outcome,
    rationale: v.rationale,
    confidence: v.confidence,
    escalation: v.escalation,
    write_intended: v.writeIntended,
  };
}
