/**
 * A milestone change prepares its own status update (server only).
 *
 * The trigger side of the shared preparation contract for the status job. It
 * is off unless the workspace has turned it on, it drafts only, and the same
 * milestone state prepares one update however many times the event arrives.
 *
 * Counts and state checks are computed here in code. Only the wording goes to
 * the model, through the one reasoning boundary, with the material quoted as
 * data so nothing inside it can give orders.
 */

import type { ID } from "@/domain/entities";
import type { DeliveryRisk, DeliveryTask, MilestoneRecord } from "@/domain/milestone-delivery";
import { milestoneReading } from "@/domain/milestone-delivery";
import type { PreparationPolicy, PreparationRequest } from "@/domain/preparation-jobs";
import {
  runPreparation,
  type DeterministicRead,
  type PreparationRunInput,
} from "@/lib/preparation-runner.server";

export const MILESTONE_STATUS_JOB = "milestone_status_draft" as const;

/** The subject and revision a status update is prepared from. */
export function statusPreparationRequest(input: {
  organizationId: ID;
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
  triggerEventId: string;
}): PreparationRequest {
  const complete = input.tasks.filter((task) => task.state === "complete").length;
  return {
    organizationId: input.organizationId,
    jobId: MILESTONE_STATUS_JOB,
    subjectRef: `${input.organizationId}::milestone::${input.milestone.milestoneId}`,
    // The revision moves only when the milestone actually moves.
    inputRevision: [
      input.milestone.state,
      complete,
      input.tasks.length,
      input.milestone.testResults.length,
      input.milestone.evidence.length,
    ].join("|"),
    triggerEventId: input.triggerEventId,
  };
}

/** Everything the update rests on, worked out without a model. */
export function statusDeterministicRead(input: {
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
  risks: DeliveryRisk[];
  ownerLabel?: string;
}): DeterministicRead {
  const reading = milestoneReading({ milestone: input.milestone, tasks: input.tasks });
  const complete = input.tasks.filter((task) => task.state === "complete").length;
  const failed = input.milestone.testResults.filter((result) => !result.passed).length;
  const ownerLabel = input.ownerLabel ?? "Unassigned";

  const figures = {
    tasksTotal: input.tasks.length,
    tasksComplete: complete,
    checksRecorded: input.milestone.testResults.length,
    checksFailed: failed,
    evidenceRecorded: input.milestone.evidence.length,
    risksOpen: input.risks.length,
  };

  if (input.milestone.evidence.length === 0 && input.milestone.testResults.length === 0) {
    return {
      figures,
      evidenceRefs: [],
      ownerLabel,
      material: [],
      cannotPrepareBecause:
        "Nothing has been recorded against this milestone yet, so there is nothing to report.",
    };
  }

  // Three separate readings, never collapsed into one.
  const material = [
    {
      ref: `${input.milestone.milestoneId}::state`,
      text: [
        `Tasks finished: ${complete} of ${input.tasks.length}.`,
        reading.accepted
          ? `Accepted by ${input.milestone.decidedBy ?? "someone"}.`
          : reading.readyForAcceptance
            ? "Ready for a person to accept or reject. Not accepted yet."
            : `Not ready for acceptance: ${reading.missing.join(" ")}`,
        reading.clientOutcomeConfirmed
          ? "The client outcome behind this milestone has been confirmed."
          : "Whether the client got the outcome they wanted has not been confirmed.",
      ].join("\n"),
    },
    ...input.milestone.evidence.map((entry) => ({
      ref: entry.ref,
      text: `${entry.label} (recorded ${entry.recordedAt})`,
    })),
    ...input.risks.map((risk) => ({
      ref: risk.id,
      text: `Risk: ${risk.what}. Why: ${risk.because}. Held by ${risk.ownerId}. Next: ${risk.nextAction}.`,
    })),
  ];

  return {
    figures,
    evidenceRefs: material.map((entry) => entry.ref),
    ownerLabel,
    material,
    ...(failed > 0
      ? { needsDecisionBecause: `${failed} check(s) did not pass, so a person should read this before it goes anywhere.` }
      : {}),
  };
}

/**
 * Called when a milestone moves, not by a button. Returns null when the job is
 * off in this workspace, which is the default, so nothing is prepared.
 */
export async function prepareStatusOnMilestoneChange(input: {
  organizationId: ID;
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
  risks: DeliveryRisk[];
  triggerEventId: string;
  policy: PreparationPolicy;
  ownerLabel?: string;
  runner?: Omit<PreparationRunInput, "request" | "policy" | "currentInputRevision" | "deterministic">;
}) {
  if (!input.policy.enabledJobs.includes(MILESTONE_STATUS_JOB)) {
    return null;
  }
  if (!input.runner) {
    throw new Error("A store and token are required to prepare a status update.");
  }
  const request = statusPreparationRequest(input);
  return runPreparation({
    ...input.runner,
    request,
    policy: input.policy,
    currentInputRevision: request.inputRevision,
    deterministic: () =>
      statusDeterministicRead({
        milestone: input.milestone,
        tasks: input.tasks,
        risks: input.risks,
        ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
      }),
  });
}
