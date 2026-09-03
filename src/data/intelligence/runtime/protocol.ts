/**
 * The shared problem-solving protocol.
 *
 * inspect → retrieve → hypothesise → test safely → observe evidence →
 * adjust → act within boundary → verify → escalate.
 *
 * The lesson from the OpenClaw diagnostic: the reasoning was right and the
 * completion failed, because "the action ran" was accepted as proof and a
 * failed attempt produced a dead end instead of the next bounded diagnostic
 * step. This module encodes the recovery discipline as data: after a failed
 * or blocked attempt, the runtime names the next safe step, a different
 * inspection angle, a missing retrieval, a re-read of state, and escalates
 * only when the bounded options are genuinely exhausted or the boundary
 * requires a person.
 *
 * Pure: it decides the next step; it never performs one.
 */

import {
  PROTOCOL_STAGES,
  type CompletionEvidenceKind,
  type ProtocolAttempt,
  type ProtocolStage,
} from "@/domain/intelligence-runtime";

export { PROTOCOL_STAGES };

/** Failed attempts before the protocol stops diagnosing and escalates. */
export const MAX_DIAGNOSTIC_ATTEMPTS = 3;

export interface DiagnosticContext {
  /** What the runtime is trying to accomplish. */
  objective: string;
  /** Gaps the read already named. */
  unknowns: string[];
  /** Inspections available from matched canon shapes (evidenceToInspect). */
  inspectionsAvailable: { id: string; question: string }[];
  /** Operations the room may safely run as a test (routable, reversible). */
  safeTests: string[];
  /** The boundary, when a person must act. */
  blockedOn?: string;
}

export type ProtocolNext =
  | { kind: "step"; stage: ProtocolStage; action: string; bounded: true }
  | { kind: "verify"; claim: string; evidenceKind: CompletionEvidenceKind }
  | { kind: "escalate"; because: string; blockedOn: string };

/**
 * The next bounded step after the attempts so far. Never returns a bare
 * "couldn't complete": it returns a step, a verification requirement, or an
 * escalation that names exactly what is missing and who must supply it.
 */
export function nextProtocolStep(
  attempts: ProtocolAttempt[],
  context: DiagnosticContext,
): ProtocolNext {
  /* A human boundary outranks every diagnostic instinct. */
  const blockedByBoundary = attempts.find(
    (attempt) => attempt.outcome === "blocked" && attempt.stage === "act_within_boundary",
  );
  if (blockedByBoundary ?? context.blockedOn) {
    return {
      kind: "escalate",
      because:
        "The next step crosses the authorization boundary. Diagnostics cannot substitute for a person's approval.",
      blockedOn: context.blockedOn ?? "approval",
    };
  }

  if (attempts.length === 0) {
    return {
      kind: "step",
      stage: "inspect",
      action: `Inspect the current evidence for: ${context.objective}`,
      bounded: true,
    };
  }

  const last = attempts[attempts.length - 1]!;
  const failures = attempts.filter((attempt) => attempt.outcome === "failed");

  if (last.outcome === "success") {
    return {
      kind: "verify",
      claim: last.action,
      evidenceKind: "changed_state",
    };
  }

  /* Failed or blocked: name the next diagnostic move. */
  const untried = context.inspectionsAvailable.find(
    (inspection) =>
      !attempts.some((attempt) => attempt.action.includes(inspection.question)) &&
      !attempts.some((attempt) => attempt.evidence === inspection.id),
  );

  if (untried && failures.length < MAX_DIAGNOSTIC_ATTEMPTS) {
    return {
      kind: "step",
      stage: "test_safely",
      action: `Inspect: ${untried.question}`,
      bounded: true,
    };
  }

  const unretrieved = context.unknowns.filter(
    (unknown) => !attempts.some((attempt) => attempt.action.includes(unknown)),
  );
  if (unretrieved.length > 0 && failures.length < MAX_DIAGNOSTIC_ATTEMPTS) {
    return {
      kind: "step",
      stage: "retrieve",
      action: `Retrieve the missing evidence: ${unretrieved[0]}`,
      bounded: true,
    };
  }

  if (failures.length < MAX_DIAGNOSTIC_ATTEMPTS) {
    return {
      kind: "step",
      stage: "adjust",
      action: `Adjust the reading: the attempt "${last.action}" ruled something out. Re-inspect with that constraint before acting.`,
      bounded: true,
    };
  }

  return {
    kind: "escalate",
    because: `${failures.length} bounded attempts made no progress (${attempts
.slice(-MAX_DIAGNOSTIC_ATTEMPTS)
.map((attempt) => attempt.action)
.join("; ")}).`,
    blockedOn: context.unknowns[0] ?? "the evidence the suite does not hold",
  };
}

/** The stage order, for readouts that show where a pass currently stands. */
export function stageIndex(stage: ProtocolStage): number {
  return PROTOCOL_STAGES.indexOf(stage);
}
