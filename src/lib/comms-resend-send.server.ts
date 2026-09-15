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

import { providerBody, providerSubject } from "@/domain/comms-delivery";
import {
  loadDraftForSend,
  outboundPayloadForDraft,
  OutboundPayloadUnavailable,
} from "@/lib/comms-outbound-payload.server";
import {
  claimDelivery,
  identifySender,
  reviewReadinessForSend,
  settleDelivery,
  SendRefused,
} from "@/lib/comms-send-authority.server";

export interface ResendSendResult {
  state: "sent" | "failed" | "unknown" | "duplicate";
  note: string;
  providerMessageId?: string;
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

  /* The caller is proved first; every read below then runs as them, under
     this workspace's own rules. */
  const caller = await identifySender(input.token, input.organizationId);

  let payload;
  let draftId: string;
  try {
    const draft = await loadDraftForSend(caller.client, input.organizationId, input.draftId);
    draftId = draft.id;
    payload = await outboundPayloadForDraft(caller.client, {
      organizationId: input.organizationId,
      draft,
      channel: "email_resend",
      senderIdentity: from,
    });
  } catch (error) {
    if (error instanceof OutboundPayloadUnavailable) {
      throw new SendRefused(error.code, error.message);
    }
    throw error;
  }

  const readiness = await reviewReadinessForSend(caller, {
    organizationId: input.organizationId,
    draftId,
    payload,
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
    draftId,
    approvalId: readiness.decision.approvalId,
    fingerprint: readiness.fingerprint,
    channel: "email_resend",
    userId: caller.userId,
  });
  if (!attempt.fresh) {
    return { state: "duplicate", note: attempt.note };
  }
  /* The gap between deciding and claiming is real: a writing habit kept or
     stopped in it changes the context this approval covers. Asked again now,
     before anything reaches a provider. */
  await requireCurrentContextAfterClaim(caller, {
    organizationId: input.organizationId,
    draftId,
    payload,
    deliveryId: attempt.id,
    channel: "email_resend",
  });


  /* From here a real message may exist in the world. Every branch below has
     to be honest about whether it does. The provider is handed exactly the
     normalisation the approval was computed over. */
  let providerMessageId: string | null = null;
  let state: "sent" | "failed" | "unknown" = "unknown";
  let detail: string | null = null;
  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from,
        to: [payload.recipient],
        ...(payload.cc && payload.cc.length > 0 ? { cc: payload.cc } : {}),
        ...(payload.bcc && payload.bcc.length > 0 ? { bcc: payload.bcc } : {}),
        subject: providerSubject(payload),
        text: providerBody(payload),
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
    note: settled.note,
    ...(providerMessageId ? { providerMessageId } : {}),
  };
}

export interface SendReadinessReport {
  /** True only when pressing Send now would actually be allowed to proceed. */
  ready: boolean;
  code: string | null;
  message: string;
  blockers: string[];
  /** False when this server cannot send email at all. Never says why in detail. */
  configured: boolean;
}

/**
 * The same decision as a send, asked without sending. Nothing is claimed, no
 * provider is contacted, and no record is written. It exists so a person can
 * see, before they commit, whether the approval on record still covers the
 * message as it now stands.
 */
export async function resendSendReadiness(input: {
  token: string;
  organizationId: string;
  draftId: string;
}): Promise<SendReadinessReport> {
  const apiKey = process.env["RESEND_API_KEY"];
  const from = process.env["RESEND_FROM_EMAIL"];
  if (!apiKey || !from) {
    return {
      ready: false,
      code: "server_not_configured",
      configured: false,
      message:
        "Email sending is not set up on this server, so nothing can be sent from here yet. The review itself still works.",
      blockers: ["This workspace has no configured sending address."],
    };
  }

  const caller = await identifySender(input.token, input.organizationId);
  let payload;
  let draftId: string;
  try {
    const draft = await loadDraftForSend(caller.client, input.organizationId, input.draftId);
    draftId = draft.id;
    payload = await outboundPayloadForDraft(caller.client, {
      organizationId: input.organizationId,
      draft,
      channel: "email_resend",
      senderIdentity: from,
    });
  } catch (error) {
    if (error instanceof OutboundPayloadUnavailable) {
      return {
        ready: false,
        code: error.code,
        configured: true,
        message: error.message,
        blockers: [],
      };
    }
    throw error;
  }

  const readiness = await reviewReadinessForSend(caller, {
    organizationId: input.organizationId,
    draftId,
    payload,
  });
  if (readiness.decision.allowed) {
    return {
      ready: true,
      code: null,
      configured: true,
      message:
        "Approved for exactly this message, as it stands right now. Sending it is still a person's decision.",
      blockers: [],
    };
  }
  return {
    ready: false,
    code: readiness.decision.code,
    configured: true,
    message: readiness.decision.message,
    blockers: readiness.decision.blockers,
  };
}

