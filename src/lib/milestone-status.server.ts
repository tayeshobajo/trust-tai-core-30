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

import type { ID, ISODateTime } from "@/domain/entities";
import type {
  DeliveryRisk,
  DeliveryTask,
  MilestoneRecord,
} from "@/domain/milestone-delivery";
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
}): DeterministicRead {
  const reading = milestoneReading({ milestone: input.milestone, tasks: input.tasks });
  const complete = input.tasks.filter((task) => task.state === "complete").length;

  return {
    figures: {
      tasksTotal: input.tasks.length,
      tasksComplete: complete,
      checksRecorded: input.milestone.testResults.length,
      checksFailed: input.milestone.testResults.filter((result) => !result.passed).length,
      evidenceRecorded: input.milestone.evidence.length,
      risksOpen: input.risks.length,
    },
    statements: [
      `Tasks finished: ${complete} of ${input.tasks.length}.`,
      reading.accepted
        ? `Accepted by ${input.milestone.decidedBy ?? "someone"}.`
        : reading.readyForAcceptance
          ? "Ready for a person to accept or reject."
          : `Not ready for acceptance: ${reading.missing.join(" ")}`,
      reading.clientOutcomeConfirmed
        ? "The client outcome behind this milestone has been confirmed."
        : "Whether the client got the outcome they wanted has not been confirmed.",
      ...input.risks.map(
        (risk) => `Risk: ${risk.what}. Why: ${risk.because}. Held by ${risk.ownerId}. Next: ${risk.nextAction}.`,
      ),
    ],
  };
}

export interface PreparedStatusUpdate {
  milestoneId: string;
  /** A draft. Nothing here is sent, and nothing here is a commitment. */
  draft: string;
  preparedAt: ISODateTime;
  basis: string[];
}

/**
 * Prepare a status update when a milestone moves. Returns null while the job
 * is off, which is the default for every workspace.
 */
export async function prepareStatusOnMilestoneChange(input: {
  organizationId: ID;
  milestone: MilestoneRecord;
  tasks: DeliveryTask[];
  risks: DeliveryRisk[];
  triggerEventId: string;
  policy: PreparationPolicy;
  at: ISODateTime;
  run?: (runInput: PreparationRunInput) => Promise<{ text: string }>;
}): Promise<PreparedStatusUpdate | null> {
  if (!input.policy.enabledJobs.includes(MILESTONE_STATUS_JOB)) return null;
  if (!input.run) throw new Error("No preparation runner was provided.");

  const request = statusPreparationRequest({
    organizationId: input.organizationId,
    milestone: input.milestone,
    tasks: input.tasks,
    triggerEventId: input.triggerEventId,
  });
  const read = statusDeterministicRead({
    milestone: input.milestone,
    tasks: input.tasks,
    risks: input.risks,
  });

  const result = await runPreparation({
    request,
    policy: input.policy,
    read,
    material: input.milestone.evidence.map((entry) => ({
      ref: entry.ref,
      text: entry.label,
    })),
    run: input.run,
  });

  if (!result) return null;

  return {
    milestoneId: input.milestone.milestoneId,
    draft: result.text,
    preparedAt: input.at,
    basis: read.statements,
  };
}
