/**
 * Preparing a conversation brief through the existing preparation rules.
 *
 * Counting and state checks happen here in code. Only the writing goes to the
 * model, through the one reasoning route the rest of the system already uses.
 * Source material travels wrapped as quoted material, so nothing written
 * inside a client's email can give instructions or widen what we may read.
 */

import type { ID, ISODateTime } from "@/domain/entities";
import type { BriefSource, ConversationBrief } from "@/domain/conversation-brief";
import { assembleBrief, briefKey, eligibleSources } from "@/domain/conversation-brief";
import type { PreparationRunInput } from "@/domain/preparation-jobs";

export const CONVERSATION_BRIEF_JOB = "conversation_summary_actions" as const;

export interface BriefDeterministicRead {
  sourceCount: number;
  latestAt: ISODateTime | null;
  /** Source ids that could not be read, and why, named rather than dropped. */
  notRead: string[];
  material: string;
}

/** Everything a person could count themselves, counted in code. */
export function briefDeterministicRead(
  clientRef: string,
  sources: BriefSource[],
): BriefDeterministicRead {
  const { eligible, rejected } = eligibleSources(clientRef, sources);
  const latest = eligible
    .map((source) => source.occurredAt)
    .sort()
    .at(-1);
  return {
    sourceCount: eligible.length,
    latestAt: latest ?? null,
    notRead: rejected,
    material: eligible
      .map(
        (source) =>
          `<<<material ref=${source.sourceId} kind=${source.kind} at=${source.occurredAt}>>>\n${source.rawText}\n<<<end material>>>`,
      )
      .join("\n\n"),
  };
}

export interface BriefPreparationRequest {
  job: typeof CONVERSATION_BRIEF_JOB;
  organizationId: ID;
  /** Changes whenever the conversation does, so an old brief reads as stale. */
  inputRevision: string;
  idempotencyKey: string;
  read: BriefDeterministicRead;
}

export function briefPreparationRequest(input: {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
}): BriefPreparationRequest {
  const read = briefDeterministicRead(input.clientRef, input.sources);
  const key = briefKey(
    input.organizationId,
    input.clientRef,
    eligibleSources(input.clientRef, input.sources).eligible.map((source) => source.sourceId),
  );
  return {
    job: CONVERSATION_BRIEF_JOB,
    organizationId: input.organizationId,
    inputRevision: `${read.sourceCount}|${read.latestAt ?? "none"}`,
    idempotencyKey: key,
    read,
  };
}

export interface BriefRunOptions {
  organizationId: ID;
  clientRef: string;
  sources: BriefSource[];
  preparedAt: ISODateTime;
  /** Off unless the workspace has switched this job on. */
  jobEnabled: boolean;
  runner?: PreparationRunInput["callModel"];
  /** Turns the model's writing into brief lines. Refuses unreadable output. */
  parse: (raw: string) => {
    goal?: ConversationBrief["goal"];
    knownFacts?: ConversationBrief["knownFacts"];
    openQuestions?: ConversationBrief["openQuestions"];
    commitments?: ConversationBrief["commitments"];
    nextMove?: ConversationBrief["nextMove"];
  };
}

/**
 * Prepare a brief when a conversation moves. Returns null while the job is off
 * in this workspace: preparation is never armed by being written.
 */
export async function prepareBriefOnConversation(
  options: BriefRunOptions,
): Promise<ConversationBrief | null> {
  if (!options.jobEnabled) return null;
  if (!options.runner) throw new Error("No preparation runner is configured.");

  const request = briefPreparationRequest(options);
  if (request.read.sourceCount === 0) return null;

  const result = await options.runner({
    job: CONVERSATION_BRIEF_JOB,
    material: request.read.material,
  } as never);
  const parsed = options.parse(result.raw);

  return assembleBrief({
    organizationId: options.organizationId,
    clientRef: options.clientRef,
    sources: options.sources,
    preparedAt: options.preparedAt,
    ...parsed,
  });
}
