/**
 * The events that prepare work (server only).
 *
 * These are the entry points a room calls when something actually happened: an
 * enquiry arrived, a conversation gained a message, a milestone moved. They
 * are not buttons and they are not helpers a test calls to prove a point. A
 * room calls one of these with the signed-in person's own token, and nothing
 * else about the caller is trusted: the workspace, the owner and the source
 * are all read back off the record by the reader.
 *
 * Every one of them is a no-op in a workspace that has not switched the job
 * on, which is every workspace until an authorised person decides otherwise.
 */

import type {
  PreparationJobId,
  PreparationOutput,
  PreparationRequest,
} from "@/domain/preparation-jobs";
import { runtimeProviderStatus } from "@/lib/intelligence-runtime.server";
import { loadPreparationPolicy } from "@/lib/preparation-policy.server";
import { callerClient } from "@/lib/preparation-readers.server";
import { preparationStore } from "@/lib/preparation-store.server";
import { runPreparation } from "@/lib/preparation-runner.server";
import { registerPreparationReaders } from "@/lib/preparation-wiring.server";
import { subjectReader } from "@/lib/preparation-subjects.server";

registerPreparationReaders();

/**
 * What this workspace genuinely has set up. Read, never assumed: a job that
 * needs an ICP does not run in a workspace that has never written one.
 */
export async function configuredKeys(input: {
  organizationId: string;
  token: string;
}): Promise<string[]> {
  const keys: string[] = [];
  const provider = runtimeProviderStatus();
  if (provider.ready) keys.push("reasoning_provider");

  const icp = await callerClient(input.token)
    .from("icp_profiles")
    .select("id")
    .eq("organization_id", input.organizationId)
    .limit(1);
  if (!icp.error && (icp.data?.length ?? 0) > 0) keys.push("icp_profile");
  return keys;
}

export interface PreparationEvent {
  token: string;
  organizationId: string;
  subjectRef: string;
  /** The event that asked. Two copies of one event carry the same id. */
  triggerEventId?: string;
  /** The signed-in person, when there is one. Read from the session, never sent. */
  requestedBy?: string;
}

/**
 * The one path from an event to a prepared record. Returns null when the job
 * is off here, so nothing is prepared and nothing is implied.
 */
export async function prepareForEvent(
  jobId: PreparationJobId,
  event: PreparationEvent,
): Promise<PreparationOutput | null> {
  const reader = subjectReader(jobId);
  if (!reader) return null;

  const keys = await configuredKeys(event);
  const policy = await loadPreparationPolicy({
    organizationId: event.organizationId,
    configuredKeys: keys,
  });
  // Off here. Nothing is written, nothing is read, nothing is implied.
  if (policy.stopSwitch || !policy.enabledJobs.includes(jobId)) return null;

  const partial = {
    organizationId: event.organizationId,
    jobId,
    subjectRef: event.subjectRef,
    ...(event.triggerEventId ? { triggerEventId: event.triggerEventId } : {}),
    ...(event.requestedBy ? { requestedBy: event.requestedBy } : {}),
  };
  const revision = await reader.currentRevision(
    { ...partial, inputRevision: "" } as PreparationRequest,
    event.token,
  );
  const request: PreparationRequest = { ...partial, inputRevision: revision };

  return runPreparation({
    request,
    policy,
    store: preparationStore(),
    token: event.token,
    currentInputRevision: revision,
    verifySubject: (subject) => reader.belongsToWorkspace(subject, event.token),
    deterministic: () => reader.read(request, event.token),
    reloadPolicy: async () =>
      loadPreparationPolicy({
        organizationId: event.organizationId,
        configuredKeys: await configuredKeys(event),
      }),
    reloadRevision: () => reader.currentRevision(request, event.token),
  });
}

/** An enquiry has been taken in and a person is looking at Scout. */
export function onEnquiryReceived(event: PreparationEvent) {
  return prepareForEvent("enquiry_qualification_packet", event);
}

/** A conversation gained a message. */
export function onConversationMessage(event: PreparationEvent) {
  return prepareForEvent("conversation_summary", event);
}

/** A milestone moved. */
export function onMilestoneChanged(event: PreparationEvent) {
  return prepareForEvent("milestone_status_draft", event);
}
