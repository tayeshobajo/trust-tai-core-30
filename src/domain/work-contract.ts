/**
 * The Work Contract — Projects' executable intelligence unit.
 *
 * A Work Contract is the approved shape of a piece of delivery work. It
 * exists only after a person approves it; it is sequenced by Roadmap and
 * executed by Paperclip; and its completion is never a bare action claim.
 *
 * Completion semantics are explicit and ordered:
 *
 *   attempted  — the agent ran something. Proves nothing.
 *   executed   — the actions completed without error. Still not done.
 *   verified   — objective evidence confirms the acceptance criteria.
 *   human_accepted — the person reviewed and accepted. Authoritative.
 *
 * A successful tool or API call is at most "executed". Paperclip completion
 * means "ready for review" unless the owning workflow has verified the
 * acceptance criteria; human acceptance remains the final word.
 */

import type { ID } from "./entities";
import type { CompletionEvidenceKind } from "./intelligence-runtime";
import { PROTOCOL_STAGES, type ProtocolStage } from "./intelligence-runtime";

export type ExecutionState = "attempted" | "executed" | "verified" | "human_accepted";

export const EXECUTION_STATE_ORDER: ExecutionState[] = [
  "attempted",
  "executed",
  "verified",
  "human_accepted",
];

export function executionStateAtLeast(state: ExecutionState, target: ExecutionState): boolean {
  return EXECUTION_STATE_ORDER.indexOf(state) >= EXECUTION_STATE_ORDER.indexOf(target);
}

/**
 * Classify an execution claim honestly. A ran action with no verification is
 * "executed", never more. Verification without human acceptance caps at
 * "verified" when the contract requires a person's acceptance.
 */
export function classifyExecution(input: {
  actionRan: boolean;
  verificationPassed: boolean;
  humanAccepted: boolean;
}): ExecutionState | "not_attempted" {
  if (!input.actionRan) return "not_attempted";
  if (input.humanAccepted) return "human_accepted";
  if (input.verificationPassed) return "verified";
  return "executed";
}

export interface AcceptanceCriterion {
  id: string;
  statement: string;
  /** The kind of proof that counts — a feeling is not one. */
  evidenceKind: CompletionEvidenceKind;
}

export interface WorkContract {
  id: string;
  organizationId: ID;
  projectId: ID;
  objective: string;
  outcomeStatement: string;
  /** Bounded references to approved context — never raw transcript dumps. */
  sourceRefs: { kind: string; id: string; label: string }[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: string[];
  mustNotChange: string[];
  /** Who approved this contract, and when. No contract exists without it. */
  humanApproval: { approvedBy: string; approvedAt: string };
  /** Sequencing belongs to Roadmap; the contract only cites it. */
  sequencing: { owningRoom: "roadmap"; milestoneIds: string[] };
  createdAt: string;
}

/**
 * The packet Paperclip receives. Everything an experienced operator would
 * ask for before starting — and nothing raw that bounded references can
 * replace.
 */
export interface PaperclipAssignmentPacket {
  contractId: string;
  objective: string;
  outcomeStatement: string;
  sourceRefs: { kind: string; id: string; label: string }[];
  /** Confirmed project knowledge, canon patterns and prior cases, as refs. */
  knowledge: { kind: string; id: string; label: string; note?: string }[];
  priorCases: {
    caseId: string;
    patternName: string;
    lesson: string | null;
    correction: string | null;
    outcome: { decision: string; result: string } | null;
  }[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints: string[];
  mustNotChange: string[];
  capabilities: {
    availableTools: string[];
    environment: string;
  };
  /** The bounded diagnostic loop the agent must follow on failure. */
  diagnosticLoop: ProtocolStage[];
  /** Conditions under which the agent stops and asks a person. */
  escalationConditions: string[];
  /** What "ready for review" must include. */
  evidenceRequired: { claim: string; evidenceKind: CompletionEvidenceKind; description: string }[];
}

/** The diagnostic loop every assignment packet carries. */
export const ASSIGNMENT_DIAGNOSTIC_LOOP: ProtocolStage[] = [...PROTOCOL_STAGES];

export const DEFAULT_ESCALATION_CONDITIONS: string[] = [
  "A step would change anything on the mustNotChange list.",
  "The acceptance criteria cannot be verified with the available tools.",
  "Three bounded diagnostic attempts made no progress.",
  "The work requires credentials, access or authority the packet does not grant.",
];
