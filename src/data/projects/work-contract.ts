/**
 * Work Contract composition for Projects.
 *
 * Pure builders: they shape the contract and the Paperclip assignment packet
 * from approved inputs. Persistence and execution live elsewhere — a
 * contract is drafted here, approved by a person, sequenced by Roadmap, and
 * only then handed to Paperclip. Nothing in this module performs a
 * consequential write.
 */

import {
  ASSIGNMENT_DIAGNOSTIC_LOOP,
  DEFAULT_ESCALATION_CONDITIONS,
  type AcceptanceCriterion,
  type PaperclipAssignmentPacket,
  type WorkContract,
} from "@/domain/work-contract";
import type { RetrievedKnowledgeRef } from "@/domain/intelligence-runtime";
import type { PriorCaseRef } from "@/data/intelligence/runtime/prior-cases";

let counter = 0;

export interface WorkContractDraft {
  organizationId: string;
  projectId: string;
  objective: string;
  outcomeStatement: string;
  sourceRefs: { kind: string; id: string; label: string }[];
  acceptanceCriteria: AcceptanceCriterion[];
  constraints?: string[];
  mustNotChange?: string[];
  sequencing?: { milestoneIds: string[] };
  now: string;
}

/**
 * Draft a contract. Refuses (returns null) when the draft cannot name how
 * success would be proven — a contract without acceptance criteria is a
 * hope, not a contract.
 */
export function draftWorkContract(input: WorkContractDraft): Omit<
  WorkContract,
  "humanApproval"
> | null {
  if (!input.objective.trim() || !input.outcomeStatement.trim()) return null;
  const criteria = input.acceptanceCriteria.filter(
    (criterion) => criterion.statement.trim().length > 0,
  );
  if (criteria.length === 0) return null;
  counter += 1;
  return {
    id: `wc:${input.projectId}:${counter}`,
    organizationId: input.organizationId,
    projectId: input.projectId,
    objective: input.objective.trim(),
    outcomeStatement: input.outcomeStatement.trim(),
    sourceRefs: input.sourceRefs,
    acceptanceCriteria: criteria,
    constraints: input.constraints ?? [],
    mustNotChange: input.mustNotChange ?? [],
    sequencing: {
      owningRoom: "roadmap",
      milestoneIds: input.sequencing?.milestoneIds ?? [],
    },
    createdAt: input.now,
  };
}

/**
 * A contract becomes executable only when a person approves it. Approval is
 * data on the contract, not a side effect.
 */
export function approveWorkContract(
  contract: Omit<WorkContract, "humanApproval">,
  approval: { approvedBy: string; approvedAt: string },
): WorkContract | null {
  if (!approval.approvedBy.trim()) return null;
  return { ...contract, humanApproval: approval };
}

/**
 * The assignment packet for an approved contract. Source references and
 * retrieved knowledge travel as bounded refs; raw transcripts never do.
 */
export function paperclipPacketFor(
  contract: WorkContract,
  input: {
    knowledge: RetrievedKnowledgeRef[];
    priorCases: PriorCaseRef[];
    availableTools: string[];
    environment: string;
    escalationConditions?: string[];
  },
): PaperclipAssignmentPacket {
  return {
    contractId: contract.id,
    objective: contract.objective,
    outcomeStatement: contract.outcomeStatement,
    sourceRefs: contract.sourceRefs,
    knowledge: input.knowledge.map((ref) => ({
      kind: ref.kind,
      id: ref.id,
      label: ref.label,
      ...(ref.note ? { note: ref.note } : {}),
    })),
    priorCases: input.priorCases.map((ref) => ({
      caseId: ref.caseId,
      patternName: ref.patternName,
      lesson: ref.lesson,
      correction: ref.correction,
      outcome: ref.outcome
        ? { decision: ref.outcome.decision, result: ref.outcome.result }
        : null,
    })),
    acceptanceCriteria: contract.acceptanceCriteria,
    constraints: contract.constraints,
    mustNotChange: contract.mustNotChange,
    capabilities: {
      availableTools: input.availableTools,
      environment: input.environment,
    },
    diagnosticLoop: ASSIGNMENT_DIAGNOSTIC_LOOP,
    escalationConditions: input.escalationConditions ?? DEFAULT_ESCALATION_CONDITIONS,
    evidenceRequired: contract.acceptanceCriteria.map((criterion) => ({
      claim: criterion.statement,
      evidenceKind: criterion.evidenceKind,
      description: `Objective proof that: ${criterion.statement}`,
    })),
  };
}
