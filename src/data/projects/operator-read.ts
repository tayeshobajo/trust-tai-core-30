/**
 * Projects: the operator read, composed.
 *
 * The first proof that the shared runtime supports the flow: before a
 * milestone is executable, Projects asks the runtime "what does an
 * experienced operator need to know?", over the milestone's context packet,
 * the suite's canon, and the capability registry, and folds the verified
 * RuntimeRead back into the domain contract from
 * src/domain/project-operator-read.ts.
 *
 * Pure: building the request and folding the read are pure functions. The
 * model call happens in src/lib/intelligence-runtime.server.ts.
 */

import type { ID } from "@/domain/entities";
import type { RuntimeEvidenceInput, RuntimeRead } from "@/domain/intelligence-runtime";
import type {
  OperatorCapabilityFit,
  OperatorDependency,
  OperatorEvidenceRef,
  OperatorGap,
  OperatorKnowledge,
  OperatorRisk,
  ProjectOperatorRead,
} from "@/domain/project-operator-read";
import { roomCapabilities } from "@/domain/intelligence-capabilities";
import type { ReasoningRequest } from "@/domain/intelligence-runtime";

import type { ProjectContextPacket } from "./context-packet";

/* ------------------------------------------------------------ the request */

/**
 * Turn a context packet into the evidence refs the operator read may cite.
 * Every statement keeps its provenance: decisions are decided, meeting lines
 * are observed, blockers and work items are derived from Projects' own state.
 */
export function operatorEvidenceFromPacket(packet: ProjectContextPacket): RuntimeEvidenceInput[] {
  const evidence: RuntimeEvidenceInput[] = [];
  const push = (
    bucket: string,
    tier: RuntimeEvidenceInput["tier"],
    label: string,
    statements: { statement: string }[],
  ) => {
    statements.forEach((row, index) => {
      evidence.push({
        id: `packet:${packet.project.id}:${bucket}:${index}`,
        statement: row.statement,
        owningRoom: "projects",
        tier,
        label,
      });
    });
  };

  push("decision", "decided", "Confirmed decision", packet.confirmedDecisions);
  push("constraint", "decided", "Constraint", packet.constraints);
  push("question", "observed", "Open question", packet.openQuestions);
  push("requirement", "observed", "Requirement", packet.requirements);
  push("meeting", "observed", "Meeting context", packet.meetingContext);

  packet.activeBlockers.forEach((blocker, index) => {
    evidence.push({
      id: `packet:${packet.project.id}:blocker:${index}`,
      statement: `Blocked: ${blocker.reason}${blocker.owner ? ` (owner: ${blocker.owner})`: ""}`,
      owningRoom: "projects",
      tier: "derived",
      label: "Active blocker",
    });
  });

  packet.currentWork.forEach((work, index) => {
    evidence.push({
      id: `packet:${packet.project.id}:work:${index}`,
      statement: `Work in flight: ${work.title}, ${work.status}${work.dueDate ? `, due ${work.dueDate}`: ""}`,
      owningRoom: "projects",
      tier: "derived",
      label: "Current work",
    });
  });

  return evidence;
}

/**
 * The reasoning request for one milestone. The caller passes the packet it
 * assembled under RLS plus any meeting/file refs the milestone is known to
 * depend on; the runtime gets exactly this, and nothing beyond it.
 */
export function operatorReadRequestFor(input: {
  packet: ProjectContextPacket;
  milestoneId: string;
  milestoneName: string;
  organizationId: ID;
  evidenceRefs?: OperatorEvidenceRef[];
  now: string;
}): ReasoningRequest {
  const capabilities = roomCapabilities("projects");
  const milestone = input.packet.roadmap.milestoneName ?? input.milestoneName;

  return {
    room: "projects",
    objective: `What does an experienced operator need to know before the milestone "${milestone}" in ${input.packet.project.name} is executable?`,
    organizationId: input.organizationId,
    evidence: operatorEvidenceFromPacket(input.packet),
    allowedOperations: capabilities.executable.map((cap) => cap.operation),
    output: "operator_read",
    approval: { required: true, permission: "projects.write" },
    verification: {
      kind: "acceptance_criterion",
      description:
        "Each acceptance criterion proposed for this milestone is checked, and the result is on record.",
    },
    now: input.now,
  };
}

/* ---------------------------------------------------------------- the fold */

const GAP_CUES = /\b(missing|unknown|unclear|no decision|not confirmed|unanswered|lacking)\b/i;
const RISK_CUES = /\b(risk|blocked|blocker|stall|overdue|conflict|slip|dependency)\b/i;

/**
 * Fold a verified RuntimeRead into the Projects operator read. Anything the
 * runtime could not ground lands in missingContext or clarifyingQuestions;
 * nothing is filled in to look complete.
 */
export function foldOperatorRead(input: {
  read: RuntimeRead;
  packet: ProjectContextPacket;
  milestoneId: string;
  operatorSummary?: string;
}): ProjectOperatorRead {
  const { read, packet } = input;
  const capabilities = roomCapabilities("projects");

  const missingContext: OperatorGap[] = read.unknowns.map((unknown) => ({
    missing: unknown,
    whyItMatters: "The operator read could not ground this from the evidence supplied.",
...(GAP_CUES.test(unknown) ? { closesWith: "meeting" as const }: {}),
  }));

  /* Open questions in the packet are gaps by definition. */
  for (const [index, question] of packet.openQuestions.entries()) {
    missingContext.push({
      missing: question.statement,
      whyItMatters: "An open question on the packet; executing past it is guessing.",
      closesWith: "meeting",
    });
    void index;
  }

  const patternKnowledge: OperatorKnowledge[] = read.knowledge
.filter((item) =>
      ["canon_pattern", "diagnostic_chain", "prior_case", "human_correction"].includes(item.kind),
    )
.map((item) => ({
      kind: item.kind as OperatorKnowledge["kind"],
      id: item.id,
      label: item.label,
      applies: item.note ?? item.label,
    }));

  const risks: OperatorRisk[] = [
...read.interpretations
.filter((interpretation) => RISK_CUES.test(interpretation.claim))
.map((interpretation) => ({
        risk: interpretation.claim,
        because: interpretation.because,
        restsOn: interpretation.restsOn,
      })),
...packet.activeBlockers.map((blocker, index) => ({
      risk: `Active blocker: ${blocker.reason}`,
      because: "On the context packet as an active blocker.",
      restsOn: [`packet:${packet.project.id}:blocker:${index}`],
    })),
  ];

  const dependencies: OperatorDependency[] = packet.currentWork.map((work) => ({
    dependsOn: work.title,
    owner: work.owner ?? "unassigned",
    state: work.status === "done" ? "met": work.status === "blocked" ? "open": "unknown",
  }));

  const capabilityFit: OperatorCapabilityFit = {
    fits: capabilities.executable.map((cap) => cap.operation),
    gaps: read.nextSteps
.filter((step) => step.external)
.map((step) => `${step.title}, external; a person carries it`),
    external: capabilities.externalSurfaces,
  };

  const clarifyingQuestions = packet.openQuestions.map((question) => question.statement);
  const clarificationRequired =
    read.confidence === "unknown" ||
    (packet.confirmedDecisions.length === 0 && packet.requirements.length === 0);

  return {
    projectId: packet.project.id,
    milestoneId: input.milestoneId,
    operatorSummary:
      input.operatorSummary ??
      (read.facts.length > 0
        ? `Grounded in ${read.facts.length} facts from the project packet.`
: "The packet holds too little to read this milestone responsibly."),
    facts: read.facts,
    missingContext,
    patternKnowledge,
    risks,
    dependencies,
    proposedAcceptanceCriteria: read.verification.map((requirement) => ({
      criterion: requirement.claim,
      evidenceKind: requirement.evidenceKind,
    })),
    capabilityFit,
    verificationPlan: read.verification,
    clarificationRequired,
    clarifyingQuestions,
    confidence: read.confidence,
    generatedAt: read.generatedAt,
    reasonedByModel: read.reasonedByModel,
  };
}
