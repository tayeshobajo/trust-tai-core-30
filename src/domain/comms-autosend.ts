/**
 * One decision: may a freshly-drafted Scout intro send itself, or must it wait
 * for a person?
 *
 * The whole system's default is unchanged: a message leaves only when the send
 * authority (src/domain/comms-delivery.ts) can PROVE an approval covering the
 * exact payload. This module does not send anything and does not weaken that.
 * It answers a narrower, earlier question — is this ONE draft eligible for the
 * system to write itself a legitimate, revocable approval instead of queuing
 * for a human click — and it says no unless every guard is satisfied.
 *
 * The four preconditions (all must hold), plus a failsafe that overrides them:
 *
 *   FAILSAFE   A first-EVER contact on a relationship always queues, even when
 *              the message type is graduated. The very first thing this person
 *              ever hears from us is never machine-sent. This is checked first
 *              and cannot be overridden by graduation.
 *
 *   (a) graduated   voice_gate_authority.autonomy_state = 'auto_send' for this
 *                   message_type. Absent row or 'bounce_only' => queue.
 *   (b) confident   the voice gate returned a confident pass — no blocking
 *                   voice violation, and (where a confidence score exists)
 *                   it clears the floor. A bounce or a soft/uncertain pass
 *                   => queue.
 *   (c) cold first  this is a first-contact cold send: the relationship has NO
 *                   prior INBOUND reply. If they have ever written back, a
 *                   machine does not answer => queue.
 *   (d) no override the voice gate hit no hard override (em dash, placeholder,
 *                   forbidden tone, missing recipient name, etc). Any hard
 *                   override => queue, regardless of graduation.
 *
 * Nothing here reads a database. The caller gathers these facts honestly and
 * passes them in; this decides and explains itself.
 */

/** The graduated-authority row for this message type, as it stands now. */
export interface AutoSendAuthorityFacts {
  /** 'auto_send' means graduated; 'bounce_only' or null means not. */
  autonomyState: "bounce_only" | "auto_send" | null;
  /** The authority row id, carried into the approval for provenance. */
  authorityId: string | null;
}

/** What the voice gate concluded about this exact draft. */
export interface AutoSendGateFacts {
  /** pass = clean; bounce = rejected; error = the gate itself failed. */
  verdict: "pass" | "bounce" | "error";
  /**
   * The confidence score, where the gate produces one (edge gateDraft does;
   * the app's deterministic checkVoice does not). Null means "no score in this
   * path" — which, on its own, is NOT treated as confident. See confidenceFloor.
   */
  confidence: number | null;
  /** The sounds-like-Tai grade, where produced. Recorded, not gated on here. */
  grade: number | null;
  /** True if any hard override fired (bounces even when the gate is otherwise up). */
  hardOverride: boolean;
  /** The gate's own reasons, carried into the approval for audit. */
  reasons: string[];
}

/** What the relationship's history shows about prior contact. */
export interface AutoSendRelationshipFacts {
  /**
   * True when there is at least one message ever recorded for this
   * relationship (in either direction). False means first-EVER contact — the
   * failsafe fires.
   */
  hasAnyPriorMessage: boolean;
  /**
   * True when the relationship has at least one INBOUND message: they have
   * written to us. A machine does not send into a live human reply.
   */
  hasInboundReply: boolean;
}

export interface AutoSendDecisionInput {
  authority: AutoSendAuthorityFacts;
  gate: AutoSendGateFacts;
  relationship: AutoSendRelationshipFacts;
  /**
   * The confidence floor, where a score exists. When the gate produces no
   * confidence (the deterministic app path), a null score is only accepted if
   * `allowMissingConfidence` is true — the caller sets that ONLY for a path
   * whose pass is itself deterministic and blocking-clean. This keeps "no
   * score" from silently reading as "confident".
   */
  confidenceFloor: number;
  allowMissingConfidence: boolean;
}

export type AutoSendVerdict =
  | { autoSend: true; reason: "graduated_confident_cold_first_contact" }
  | { autoSend: false; code: AutoSendHold; message: string };

export type AutoSendHold =
  | "first_ever_contact"
  | "not_graduated"
  | "gate_not_pass"
  | "hard_override"
  | "low_confidence"
  | "has_inbound_reply";

/**
 * The whole rule. Returns autoSend:true only when the failsafe passes AND all
 * four preconditions hold. Any hold names why, so the fallback (queue for a
 * human) can be recorded with a reason.
 */
export function decideAutoSend(input: AutoSendDecisionInput): AutoSendVerdict {
  const { authority, gate, relationship } = input;

  // FAILSAFE, checked first and unconditionally: the first thing anyone ever
  // hears from us is never machine-sent.
  if (!relationship.hasAnyPriorMessage) {
    return {
      autoSend: false,
      code: "first_ever_contact",
      message: "First-ever contact always waits for a person, even when graduated.",
    };
  }

  // (a) graduated for this message type.
  if (authority.autonomyState !== "auto_send") {
    return {
      autoSend: false,
      code: "not_graduated",
      message: "This message type has not been graduated to auto-send.",
    };
  }

  // (d) no hard override. Checked before the pass so an override is always the
  // stated reason even if the verdict somehow reads pass.
  if (gate.hardOverride) {
    return {
      autoSend: false,
      code: "hard_override",
      message: "The voice gate hit a hard override, so this waits for a person.",
    };
  }

  // (b) a pass, not a bounce or gate error.
  if (gate.verdict !== "pass") {
    return {
      autoSend: false,
      code: "gate_not_pass",
      message: `The voice gate returned ${gate.verdict}, so this waits for a person.`,
    };
  }

  // (b, cont.) confident. A real score must clear the floor. A missing score
  // is only acceptable when the caller has vouched that this path's pass is
  // itself deterministic and blocking-clean.
  if (gate.confidence === null) {
    if (!input.allowMissingConfidence) {
      return {
        autoSend: false,
        code: "low_confidence",
        message: "No confidence score is available for this pass, so this waits for a person.",
      };
    }
  } else if (gate.confidence < input.confidenceFloor) {
    return {
      autoSend: false,
      code: "low_confidence",
      message: "The voice gate's confidence is below the floor, so this waits for a person.",
    };
  }

  // (c) cold first contact: they have never written back.
  if (relationship.hasInboundReply) {
    return {
      autoSend: false,
      code: "has_inbound_reply",
      message: "This person has replied before, so a machine does not answer them.",
    };
  }

  return { autoSend: true, reason: "graduated_confident_cold_first_contact" };
}
