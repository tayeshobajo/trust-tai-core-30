/**
 * Quick reply, from the labeled inbox.
 *
 * A reply is still one human act: the words on screen become an approved
 * draft, and that same draft is what Gmail sends into the very thread it
 * answers. Nothing is rewritten, nothing is appended, nothing is queued to
 * leave later. The draft stays on record afterwards, so the send has a
 * provenance trail like every other message Comms has ever sent.
 */

import { commsService, type CommsContext } from "@/data/supabase/comms-service";
import { gmailSendDraft } from "@/data/supabase/comms-gmail";
import type { Relationship } from "@/domain/comms";
import type { GmailSendOutcome } from "@/data/supabase/comms-gmail";

export async function sendQuickReply(input: {
  relationship: Relationship;
  /** Gmail's conversation id, the reply joins this exact thread. */
  providerThreadId: string;
  subject: string;
  body: string;
  context: CommsContext;
}): Promise<GmailSendOutcome> {
  const body = input.body.trim();
  if (!body) throw new Error("Write something before sending.");
  if (!input.relationship.email) {
    throw new Error("This person has no email address yet. Add one before replying.");
  }

  const draft = await commsService.saveDraft(
    {
      relationship: input.relationship,
      register: "follow_up",
      intent: "quick_reply",
      ...(input.subject.trim() ? { subject: input.subject.trim() } : {}),
      body,
      reviewState: "approved",
      rationale: {
        quick_reply: true,
        provider_thread_id: input.providerThreadId,
      },
      evidence: [{ label: "Written by hand in the Comms inbox", kind: "human" as const }],
    },
    input.context,
  );

  return gmailSendDraft(input.context.organizationId, draft.id, {
    mode: "reply",
    providerThreadId: input.providerThreadId,
  });
}
