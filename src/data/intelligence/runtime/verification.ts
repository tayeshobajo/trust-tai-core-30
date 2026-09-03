/**
 * The completion gate.
 *
 * The OpenClaw lesson, made structural: "the action ran" is never accepted as
 * proof that the work completed. A completion claim is accepted only when it
 * carries evidence of the right kind, a test result, a changed state the
 * suite can re-read, an external system's response, an artifact, a met
 * acceptance criterion, a downstream receipt, or a person's acceptance.
 *
 * Pure: the gate judges claims; it does not collect evidence.
 */

import type {
  CompletionClaim,
  CompletionEvidence,
  CompletionEvidenceKind,
  VerificationExpectation,
} from "@/domain/intelligence-runtime";

export interface CompletionVerdict {
  accepted: boolean;
  because: string;
  /** What evidence would have to be added for the claim to be accepted. */
  missing: string[];
}

/** Evidence kinds a non-person claim may rest on. */
const OBJECTIVE_KINDS: CompletionEvidenceKind[] = [
  "test_result",
  "changed_state",
  "api_response",
  "acceptance_criterion",
  "downstream_receipt",
];

export function verifyCompletion(
  claim: CompletionClaim,
  expectation?: VerificationExpectation,
): CompletionVerdict {
  const missing: string[] = [];

  if (!claim.actionRan && claim.evidence.length === 0) {
    return {
      accepted: false,
      because: "Nothing ran and nothing proves completion.",
      missing: [expectation?.description ?? "evidence of completion"],
    };
  }

  if (claim.evidence.length === 0) {
    return {
      accepted: false,
      because:
        "Running the action is not evidence the work completed. The claim needs proof, not a log line.",
      missing: [expectation ? `${expectation.kind}: ${expectation.description}`: "any evidence"],
    };
  }

  if (expectation && !claim.evidence.some((item) => item.kind === expectation.kind)) {
    /* A person's acceptance can stand in for any expected kind. */
    if (!claim.evidence.some((item) => item.kind === "human_acceptance")) {
      missing.push(`${expectation.kind}: ${expectation.description}`);
    }
  }

  if (
    claim.acceptanceCriterion &&
    !claim.evidence.some(
      (item) => item.kind === "acceptance_criterion" || item.kind === "human_acceptance",
    )
  ) {
    missing.push(`acceptance_criterion: ${claim.acceptanceCriterion}`);
  }

  if (claim.claimedBy !== "person") {
    const objective = claim.evidence.some((item) => OBJECTIVE_KINDS.includes(item.kind));
    const humanAccepted = claim.evidence.some((item) => item.kind === "human_acceptance");
    if (!objective && !humanAccepted) {
      missing.push(
        "objective proof (test_result, changed_state, api_response, acceptance_criterion or downstream_receipt), a runtime, adapter or agent cannot grade its own homework",
      );
    }
  }

  if (missing.length > 0) {
    return {
      accepted: false,
      because: "The claim does not yet carry the proof this work requires.",
      missing,
    };
  }

  return {
    accepted: true,
    because: `Completion proven by ${claim.evidence.map((item) => item.kind).join(" + ")}.`,
    missing: [],
  };
}

/** The evidence a work type ordinarily needs, so rooms ask for it up front. */
export function expectedEvidenceFor(work: {
  changesSuiteState?: boolean;
  touchesExternalSystem?: boolean;
  handsOffToAnotherRoom?: boolean;
  producesArtifact?: boolean;
  hasAcceptanceCriteria?: boolean;
}): VerificationExpectation[] {
  const expectations: VerificationExpectation[] = [];
  if (work.changesSuiteState) {
    expectations.push({
      kind: "changed_state",
      description: "Re-read the state after the action and confirm it changed.",
    });
  }
  if (work.touchesExternalSystem) {
    expectations.push({
      kind: "api_response",
      description: "Record the external system's response, not just the request.",
    });
  }
  if (work.handsOffToAnotherRoom) {
    expectations.push({
      kind: "downstream_receipt",
      description: "The receiving room acknowledges the handoff.",
    });
  }
  if (work.producesArtifact) {
    expectations.push({
      kind: "artifact",
      description: "The produced artifact exists and is reviewable.",
    });
  }
  if (work.hasAcceptanceCriteria) {
    expectations.push({
      kind: "acceptance_criterion",
      description: "Each named acceptance criterion is checked, one by one.",
    });
  }
  return expectations;
}

/** Convenience for readouts: one line describing what a claim still owes. */
export function describeGap(verdict: CompletionVerdict): string | null {
  if (verdict.accepted) return null;
  return `${verdict.because} Missing: ${verdict.missing.join("; ")}.`;
}

export type { CompletionEvidence };
