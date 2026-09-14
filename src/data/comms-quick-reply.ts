/**
 * Quick reply, from the labeled inbox.
 *
 * A reply written here is still a message leaving the building, so it goes
 * through exactly the same door as every other one: the words become a draft,
 * a review is opened and bound to that draft, and Gmail is only asked once a
 * completed review of those exact words has been approved by somebody allowed
 * to approve. Nothing here marks its own work approved — that claim used to
 * be written straight onto the draft from the browser, which is precisely the
 * kind of self-granted permission the send gate exists to refuse.
 */

import { commsService, type CommsContext } from "@/data/supabase/comms-service";
import { gmailSendDraft } from "@/data/supabase/comms-gmail";
import { supabase } from "@/integrations/trust-tai/supabase";
import type { Relationship } from "@/domain/comms";
import type { GmailSendOutcome } from "@/data/supabase/comms-gmail";

export interface QuickReplyOutcome {
  draftId: string;
  /** The review this reply must clear before it can be sent. */
  sessionId: string | null;
  /** Present only when the message genuinely went to Gmail. */
  sent?: GmailSendOutcome;
  /** Why it did not go, in the words the gate used. */
  held?: string;
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const value = data.session?.access_token;
  if (!value) throw new Error("Your session has expired. Sign in again.");
  return value;
}

export async function sendQuickReply(input: {
  relationship: Relationship;
  /** Gmail's conversation id, the reply joins this exact thread. */
  providerThreadId: string;
  subject: string;
  body: string;
  context: CommsContext;
}): Promise<QuickReplyOutcome> {
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
      // Never "approved": approval is a review decision, recorded server side.
      reviewState: "needs_human_review",
      rationale: {
        quick_reply: true,
        provider_thread_id: input.providerThreadId,
      },
      evidence: [{ label: "Written by hand in the Comms inbox", kind: "human" as const }],
    },
    input.context,
  );

  /* Bind a review to this exact draft. If one is already open for it, the
     server hands that one back rather than opening a second. */
  let sessionId: string | null = null;
  try {
    const response = await fetch("/api/public/comms/review", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${await accessToken()}`,
      },
      body: JSON.stringify({
        action: "bind",
        organizationId: input.context.organizationId,
        draftId: draft.id,
        channel: "email_gmail",
        goal: "Reply to this conversation.",
      }),
    });
    const payload = (await response.json()) as { sessionId?: string; error?: string };
    if (response.ok && payload.sessionId) sessionId = payload.sessionId;
  } catch {
    sessionId = null;
  }

  /* The same gate as every other path. It refuses until this reply has been
     reviewed and approved, and a refusal means Gmail was never called. */
  try {
    const sent = await gmailSendDraft(input.context.organizationId, draft.id, {
      mode: "reply",
      providerThreadId: input.providerThreadId,
    });
    return { draftId: draft.id, sessionId, sent };
  } catch (error) {
    return {
      draftId: draft.id,
      sessionId,
      held: error instanceof Error ? error.message : "This reply was not sent.",
    };
  }
}
