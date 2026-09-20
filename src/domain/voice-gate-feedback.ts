/**
 * Voice-gate learning: derive the correction signal from a human's action.
 *
 * Jev cannot learn — it is stateless. The rubric improves only because Tai's
 * actions on gated drafts are recorded and reviewed. This pure module turns
 * (what the gate decided, stored in a draft's rationale.gate) × (what Tai just
 * did, the review-state transition) into one labeled feedback row.
 *
 * The label is the four-cell confusion signal. It is the ONLY ground truth the
 * weekly rubric review reads, and the record each message-type must build before
 * it earns auto-send authority. Pure: same inputs, same row, no side effects.
 */

export type GateVerdict = "pass" | "bounce" | "error";
export type HumanAction = "approved" | "sent" | "discarded" | "needs_redraft" | "other";
export type Agreement =
  | "true_pass" // gate passed, Tai approved/sent — gate right
  | "false_pass" // gate passed, Tai killed/sent back — gate too soft
  | "true_bounce" // gate bounced, Tai agreed (redraft/discard) — gate right
  | "false_bounce" // gate bounced, Tai approved/sent anyway — gate too harsh
  | "na"; // gate errored/absent, or action carries no signal

/** What the gate recorded on the draft, read back from rationale. */
export interface GateSnapshot {
  verdict: GateVerdict | null;
  grade: number | null;
  confidence: number | null;
  reasons: string[];
  messageType: string | null;
}

export interface FeedbackRow {
  gate_verdict: string;
  gate_grade: number | null;
  gate_confidence: number | null;
  gate_reasons: string[];
  message_type: string | null;
  human_action: HumanAction;
  agreement: Agreement;
}

/** Map a review-state transition to the human action it represents. */
export function actionFromReviewState(reviewState: string): HumanAction {
  switch (reviewState) {
    case "approved":
      return "approved";
    case "sent":
    case "sending":
      return "sent";
    case "discarded":
      return "discarded";
    case "needs_redraft":
      return "needs_redraft";
    default:
      return "other";
  }
}

/**
 * Read the gate block off a draft's rationale. Tolerant of shape drift: any
 * missing field becomes null rather than throwing, because a broken read here
 * must never block a human from acting on their own draft.
 */
export function readGateSnapshot(rationale: Record<string, unknown> | null | undefined): GateSnapshot {
  const r = rationale ?? {};
  const audit = (r["gate"] ?? {}) as Record<string, unknown>;
  const verdictRaw = r["gate_verdict"];
  const verdict =
    verdictRaw === "pass" || verdictRaw === "bounce" || verdictRaw === "error" ? verdictRaw : null;
  const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const reasons = Array.isArray(r["gate_reasons"])
    ? (r["gate_reasons"] as unknown[]).filter((x): x is string => typeof x === "string")
    : [];
  return {
    verdict,
    grade: num(audit["grade"]),
    confidence: num(audit["confidence"]),
    reasons,
    messageType: typeof audit["message_type"] === "string" ? (audit["message_type"] as string) : null,
  };
}

/**
 * The core derivation. Only "pass" and "bounce" carry a learning signal; an
 * "error" (fail-open) or absent verdict is "na" — the gate never actually judged.
 */
export function deriveAgreement(verdict: GateVerdict | null, action: HumanAction): Agreement {
  const humanKept = action === "approved" || action === "sent";
  const humanRejected = action === "discarded" || action === "needs_redraft";

  if (verdict === "pass") {
    if (humanKept) return "true_pass";
    if (humanRejected) return "false_pass";
    return "na";
  }
  if (verdict === "bounce") {
    if (humanRejected) return "true_bounce";
    if (humanKept) return "false_bounce";
    return "na";
  }
  return "na";
}

/**
 * Build the feedback row from a draft's stored gate snapshot and the human's
 * action. Returns null when there is nothing to learn (gate never judged AND the
 * action carries no signal), so callers can skip the write cleanly.
 */
export function buildFeedbackRow(snapshot: GateSnapshot, action: HumanAction): FeedbackRow | null {
  const agreement = deriveAgreement(snapshot.verdict, action);
  // A row is worth keeping if the gate judged (pass/bounce) OR the human did
  // something decisive; a pure "other"/"na" with no verdict teaches nothing.
  if (agreement === "na" && snapshot.verdict === null) return null;
  return {
    gate_verdict: snapshot.verdict ?? "error",
    gate_grade: snapshot.grade,
    gate_confidence: snapshot.confidence,
    gate_reasons: snapshot.reasons,
    message_type: snapshot.messageType,
    human_action: action,
    agreement,
  };
}
