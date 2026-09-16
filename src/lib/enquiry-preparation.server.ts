/**
 * A new enquiry prepares its own qualification packet (server only).
 *
 * This is the trigger side of the shared preparation contract: when an enquiry
 * is taken in and the workspace has turned the job on, the packet is prepared
 * there and then. No button is required for it to happen, and a button cannot
 * make it happen when the job is off.
 *
 * Deterministic parts are computed here in code. Only the wording of the fit
 * rationale and the suggested first move goes to the model, through the one
 * reasoning boundary, and only material the workspace already holds is sent.
 */

import {
  packetReadiness,
  stripInventedIntent,
  type EnquiryIntake,
  type QualificationPacket,
} from "@/domain/enquiry-qualification";
import type { PreparationPolicy, PreparationRequest } from "@/domain/preparation-jobs";
import type { WebsiteSubmission } from "@/domain/website";
import {
  runPreparation,
  type DeterministicRead,
  type PreparationRunInput,
} from "@/lib/preparation-runner.server";

/** The subject and revision a qualification packet is prepared from. */
export function enquiryPreparationRequest(
  intake: EnquiryIntake,
  submission: WebsiteSubmission,
): PreparationRequest {
  return {
    organizationId: intake.context.organizationId,
    jobId: "enquiry_qualification_packet",
    subjectRef: intake.key,
    // The revision moves when what we know about the enquiry moves.
    inputRevision: [submission.submissionId, submission.receivedAt, intake.link.state].join("|"),
    triggerEventId: submission.submissionId,
  };
}

/**
 * Everything the packet rests on, computed without a model: counts, what was
 * actually said, and the ICP criteria the person will judge against.
 */
export function enquiryDeterministicRead(input: {
  intake: EnquiryIntake;
  submission: WebsiteSubmission;
  icp: { version: number; title: string; criteria: string[] } | null;
  ownerLabel?: string;
}): DeterministicRead {
  const { intake, submission, icp } = input;
  const spoken = submission.verbatim
    .filter((answer) => !answer.skipped)
    .map((answer) => (answer.answerText ?? "").trim())
    .filter((text) => text.length > 0);

  const unknowns: string[] = [];
  if (!submission.company.website) unknowns.push("We do not have their website.");
  if (!submission.person.email) unknowns.push("We do not have an email for them.");
  if (!icp) unknowns.push("There is no ICP recorded to judge fit against.");
  if (submission.consent.marketingOptIn === null) {
    unknowns.push("They were not asked about marketing contact.");
  }

  const figures = {
    answersGiven: spoken.length,
    icpCriteria: icp?.criteria.length ?? 0,
    unknownsAtIntake: unknowns.length,
  };

  if (intake.unavailable) {
    return {
      figures,
      evidenceRefs: [],
      ownerLabel: input.ownerLabel ?? "Unassigned",
      material: [],
      cannotPrepareBecause: intake.unavailableBecause ?? "This source is not available.",
    };
  }
  if (spoken.length === 0) {
    return {
      figures,
      evidenceRefs: [],
      ownerLabel: input.ownerLabel ?? "Unassigned",
      material: [],
      cannotPrepareBecause: "They did not tell us anything we can prepare from.",
    };
  }

  const material = [
    {
      ref: `enquiry:${intake.key}`,
      text: [
        `Company as given: ${submission.company.name ?? "not given"}`,
        `Website as given: ${submission.company.website ?? "not given"}`,
        `How they reached us: ${intake.context.sourceChannel}`,
        `What they told us, in their words:`,
        ...spoken.map((text) => `- ${text}`),
        icp
          ? `ICP to judge against (${icp.title}, version ${icp.version}):\n${icp.criteria.map((c) => `- ${c}`).join("\n")}`
          : "There is no ICP recorded. Do not claim fit.",
        unknowns.length > 0 ? `Not known: ${unknowns.join(" ")}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  ];

  return {
    figures,
    evidenceRefs: [`enquiry:${intake.key}`, `website_submission:${submission.submissionId}`],
    ownerLabel: input.ownerLabel ?? "Unassigned",
    material,
    ...(intake.link.state === "unlinked"
      ? { needsDecisionBecause: "Someone needs to say which company this enquiry belongs to." }
      : {}),
  };
}

/**
 * Called by intake, not by a button. Returns null when the job is off in this
 * workspace, so nothing is prepared and nothing is implied.
 */
export async function prepareEnquiryOnIntake(input: {
  intake: EnquiryIntake;
  submission: WebsiteSubmission;
  icp: { version: number; title: string; criteria: string[] } | null;
  policy: PreparationPolicy;
  ownerLabel?: string;
  runner?: Omit<PreparationRunInput, "request" | "policy" | "currentInputRevision" | "deterministic">;
}) {
  if (!input.policy.enabledJobs.includes("enquiry_qualification_packet")) {
    return null;
  }
  if (!input.runner) {
    throw new Error("A store and token are required to prepare an enquiry.");
  }
  const request = enquiryPreparationRequest(input.intake, input.submission);
  return runPreparation({
    ...input.runner,
    request,
    policy: input.policy,
    currentInputRevision: request.inputRevision,
    deterministic: () =>
      enquiryDeterministicRead({
        intake: input.intake,
        submission: input.submission,
        icp: input.icp,
        ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
      }),
  });
}

/** Keep invented spend or intent out before a person reads the packet. */
export function finalisePacket(packet: QualificationPacket, saidByThem: string[]) {
  const cleaned = stripInventedIntent(packet, saidByThem);
  return { packet: cleaned, readiness: packetReadiness(cleaned) };
}
