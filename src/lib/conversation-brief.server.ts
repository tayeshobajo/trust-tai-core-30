/**
 * A conversation prepares its own brief (server only).
 *
 * This is the trigger side of the shared preparation contract for the
 * conversation job: when a conversation is recorded and the workspace has
 * turned the job on, the brief is prepared there and then.
 *
 * Counts and state checks are computed here in code. Only the writing goes to
 * the model, through the one reasoning boundary, and the material travels as
 * quoted data so nothing written inside a client's message can give orders.
 */

import type { ID, ISODateTime } from "@/domain/entities";
import type { BriefSource, ConversationBrief } from "@/domain/conversation-brief";
import { assembleBrief, briefKey, eligibleSources } from "@/domain/conversation-brief";
import type { PreparationPolicy, PreparationRequest } from "@/domain/preparation-jobs";
import {
  runPreparation,
  type DeterministicRead,
  type PreparationRunInput,
} from "@/lib/preparation-runner.server";

export const CONVERSATION_BRIEF_JOB = "conversation_summary" as const;

/** The subject and revision a brief is prepared from. */
export function briefPreparationRequest(input: {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
  triggerEventId: string;
}): PreparationRequest {
  const { eligible } = eligibleSources(input.clientRef, input.sources);
  const latest = eligible.map((source) => source.occurredAt).sort().at(-1);
  return {
    organizationId: input.organizationId,
    jobId: CONVERSATION_BRIEF_JOB,
    subjectRef: briefKey(
      input.organizationId,
      input.clientRef,
      eligible.map((source) => source.sourceId),
    ),
    // The revision moves when the conversation moves.
    inputRevision: [eligible.length, latest ?? "none"].join("|"),
    triggerEventId: input.triggerEventId,
  };
}

/**
 * Everything the brief rests on, computed without a model: which sources are
 * this client's own, how many there are, and what the latest one is.
 */
export function briefDeterministicRead(input: {
  clientRef: string;
  sources: BriefSource[];
  ownerLabel?: string;
}): DeterministicRead {
  const { eligible, rejected } = eligibleSources(input.clientRef, input.sources);
  const latest = eligible.map((source) => source.occurredAt).sort().at(-1);
  const figures = {
    sourcesRead: eligible.length,
    sourcesNotRead: rejected.length,
  };
  const ownerLabel = input.ownerLabel ?? "Unassigned";

  if (eligible.length === 0) {
    return {
      figures,
      evidenceRefs: [],
      ownerLabel,
      material: [],
      cannotPrepareBecause:
        rejected[0] ?? "There is nothing recorded in this conversation to prepare from.",
    };
  }

  return {
    figures,
    evidenceRefs: eligible.map((source) => source.sourceId),
    ownerLabel,
    material: eligible.map((source) => ({
      ref: source.sourceId,
      text: [
        `${source.kind} on ${source.occurredAt}: ${source.label}`,
        source.rawText,
      ].join("\n"),
    })),
    ...(latest ? {} : {}),
    ...(rejected.length > 0
      ? { needsDecisionBecause: `Some material was not read: ${rejected.join(" ")}` }
      : {}),
  };
}

/**
 * Called when a conversation is recorded, not by a button. Returns null when
 * the job is off in this workspace, so nothing is prepared and nothing implied.
 */
export async function prepareBriefOnConversation(input: {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
  triggerEventId: string;
  policy: PreparationPolicy;
  ownerLabel?: string;
  runner?: Omit<PreparationRunInput, "request" | "policy" | "currentInputRevision" | "deterministic">;
}) {
  if (!input.policy.enabledJobs.includes(CONVERSATION_BRIEF_JOB)) {
    return null;
  }
  if (!input.runner) {
    throw new Error("A store and token are required to prepare a conversation brief.");
  }
  const request = briefPreparationRequest(input);
  return runPreparation({
    ...input.runner,
    request,
    policy: input.policy,
    currentInputRevision: request.inputRevision,
    deterministic: () =>
      briefDeterministicRead({
        clientRef: input.clientRef,
        sources: input.sources,
        ...(input.ownerLabel ? { ownerLabel: input.ownerLabel } : {}),
      }),
  });
}

/**
 * Turn prepared wording into a brief. Grounding is re-checked here, so a line
 * the model attached to another client's material never reaches the brief.
 */
export function assemblePreparedBrief(input: {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
  preparedAt: ISODateTime;
  written: Partial<
    Pick<ConversationBrief, "goal" | "knownFacts" | "openQuestions" | "commitments" | "nextMove">
  >;
}): ConversationBrief {
  return assembleBrief({
    organizationId: input.organizationId,
    clientRef: input.clientRef,
    sources: input.sources,
    preparedAt: input.preparedAt,
    ...input.written,
  });
}
