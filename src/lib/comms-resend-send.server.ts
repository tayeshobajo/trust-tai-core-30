/**
 * The email path behind the approvals queue and Scout outreach, moved into
 * this app and put behind the one send gate.
 *
 * It used to live in a database function that ran with full administrative
 * credentials, never checked that the caller belonged to the workspace whose
 * draft it was sending, and took the draft's own `review_state` as proof of
 * approval — a value any member can write from a browser. That path is no
 * longer called.
 *
 * Here: the caller is proved, the shared authority decides, the attempt is
 * recorded before the provider is asked anything, and a provider that
 * accepted while the answer was lost is recorded as unknown rather than
 * retried.
 */

import {
  claimDelivery,
  requireSendApproval,
  settleDelivery,
  SendRefused,
} from "@/lib/comms-send-authority.server";

export interface ResendSendResult {
  state: "sent" | "failed" | "unknown" | "duplicate";
  note: string;
  providerMessageId?: string;
}

interface DraftRow {
  id: string;
  subject: string | null;
  body: string;
  relationship_id: string;
}

export async function sendDraftViaResend(input: {
  token: string;
  organizationId: string;
  draftId: string;
}): Promise<ResendSendResult> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !from) {
    throw new SendRefused(
      "server_not_configured",
      "Email sending is not configured on the server, so nothing was sent.",
    );
  }

  /* Proving the caller happens inside the gate; this read then runs as them,
     under the workspace's own rules. */
  const identity = await requireSendApproval;
  void identity;

  const { identifySender, reviewReadinessForSend } = await import(
    "@/lib/comms-send-authority.server"
  );
  const caller = await identifySender(input.token, input.organizationId);

  const draftRes = await caller.client
    .from("comms_drafts")
    .select("id, subject, body, relationship_id")
    .eq("id", input.draftId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (draftRes.error) throw new SendRefused("unreadable", "That draft could not be read.");
  const draft = (draftRes.data ?? null) as DraftRow | null;
  if (!draft) throw new SendRefused("not_found", "That draft is not on record.");

  const relationshipRes = await caller.client
    .from("comms_relationships")
    .select("id, email")
    .eq("id", draft.relationship_id)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const relationship = (relationshipRes.data ?? null) as { email: string | null } | null;
  if (!relationship?.email) {
    throw new SendRefused(
      "no_recipient",
      "This person has no email address on record, so nothing was sent.",
    );
  }
  const recipient = relationship.email.toLowerCase();

  const readiness = await reviewReadinessForSend(caller, {
    organizationId: input.organizationId,
    draftId: draft.id,
    payload: {
      channel: "email_resend",
      subject: draft.subject,
      body: draft.body,
      recipient,
      senderIdentity: from,
      attachments: [],
    },
  });
  if (!readiness.decision.allowed) {
    throw new SendRefused(
      readiness.decision.code,
      readiness.decision.message,
      readiness.decision.blockers,
    );
  }

  const attempt = await claimDelivery({
    organizationId: input.organizationId,
    draftId: draft.id,
    approvalId: readiness.decision.approvalId,
    fingerprint: readiness.fingerprint,
    channel: "email_resend",
    userId: caller.userId,
  });
  if (!attempt.fresh || !attempt.id) {
    return { state: "duplicate", note: attempt.note };
  }

  /* From here a real message may exist in the world. Every branch below has
     to be honest about whether it does. */
  let providerMessageId: string | null = null;
  let state: "sent" | "failed" | "unknown" = "unknown";
  let detail: string | null = null;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [recipient],
        subject: draft.subject ?? "(no subject)",
        text: draft.body,
      }),
    });
    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      providerMessageId = body.id ?? null;
      state = "sent";
    } else {
      /* A refusal we can read is a refusal: nothing went out. */
      detail = await response.text().catch(() => `HTTP ${response.status}`);
      state = response.status >= 400 && response.status < 500 ? "failed" : "unknown";
    }
  } catch (error) {
    /* The request left and the answer never came back. It may or may not have
       arrived. It is not retried. */
    detail = (error as Error).message;
    state = "unknown";
  }

  const settled = await settleDelivery({
    organizationId: input.organizationId,
    deliveryId: attempt.id,
    state,
    channel: "email_resend",
    providerMessageId,
    error: detail,
  });

  return {
    state,
    note: settled.recorded ? settled.note : settled.note,
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}
