/**
 * Graduated auto-send: the server orchestrator (server only).
 *
 * A freshly-drafted Scout intro that PASSED the voice gate reaches here. This
 * module answers one question and, only when the answer is yes, sends exactly
 * one message down the SAME provider path a human send uses — never a second,
 * duplicated one.
 *
 * The question is the pure rule in src/domain/comms-autosend.ts. This module
 * gathers the facts it needs honestly from the database (the graduated
 * authority for this message type, the gate verdict frozen on the draft, and
 * the relationship's prior-contact history), asks the rule, and:
 *
 *   AUTO-SEND  writes a comms_autosend_approvals row with full provenance, then
 *              runs the shared send path. That send still passes decideSend —
 *              now satisfied by the SYSTEM approval, with the same
 *              payload-fingerprint discipline as a human approval. No
 *              fingerprint match, no send.
 *
 *   QUEUE      does nothing. The draft stays needs_human_review exactly as it
 *              already is, and the reason is recorded on the draft's rationale
 *              as honest telemetry (never as a human approval).
 *
 * It never touches voice_gate_feedback: that log is Tai's action on a draft.
 * An auto-send is not Tai's action, so counting it there would forge a
 * true_pass and corrupt the confusion matrix the graduation rests on. The only
 * thing written on the learning side is a distinct auto-send telemetry block on
 * the draft's own rationale.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  decideAutoSend,
  type AutoSendVerdict,
} from "@/domain/comms-autosend";
import {
  decideSend,
  deliveryKey,
  describeDelivery,
  outboundFingerprint,
  type DeliveryState,
  type OutboundPayload,
} from "@/domain/comms-delivery";
import { postToResend, resendCredentials } from "@/lib/comms-resend-send.server";

/**
 * The message type a Scout first intro is graduated (or not) under. This is the
 * key into voice_gate_authority, deliberately distinct from the draft's
 * `register` ('scout_intro'): the authority namespace is per message TYPE, and
 * both learning migrations name this exact value as the canonical example. A
 * first intro is the only thing this orchestrator ever sends.
 */
export const SCOUT_FIRST_INTRO_MESSAGE_TYPE = "scout_first_intro";

/**
 * The confidence floor a scored pass must clear. The deterministic app gate
 * (checkVoice) produces NO score, so the caller sets allowMissingConfidence for
 * that path — a null score is accepted only because that pass is itself
 * deterministic and blocking-clean, never as a silent "confident".
 */
const CONFIDENCE_FLOOR = 0.85;

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The outcome, for the caller to log or surface. Never throws to the draft path. */
export interface AutoSendOutcome {
  /** True only when a message was actually handed to the provider by the system. */
  attempted: boolean;
  /** The provider outcome, when a send was attempted. */
  state?: DeliveryState | "duplicate";
  /** Why it queued, when it did not auto-send. */
  hold?: string;
  note: string;
}

/**
 * Consider a just-created, gate-passed Scout intro draft for graduated
 * auto-send. Safe to call unconditionally after the draft is written: it holds
 * (queues) on anything it cannot prove, and it never lets its own failure break
 * the draft path — the worst case is the draft simply waits for a person, which
 * is the existing behaviour.
 */
export async function considerAutoSend(
  service: SupabaseClient,
  input: {
    organizationId: string;
    draftId: string;
    relationshipId: string;
    /** The gate verdict for THIS draft, as the draft path already computed it. */
    gate: {
      verdict: "pass" | "bounce" | "error";
      confidence: number | null;
      grade: number | null;
      hardOverride: boolean;
      reasons: string[];
    };
  },
): Promise<AutoSendOutcome> {
  try {
    return await runAutoSend(service, input);
  } catch (error) {
    /* A failure here must never turn into a send nobody proved, and must never
       break the draft that is already safely queued. Hold, loudly in the note. */
    return {
      attempted: false,
      hold: "orchestrator_error",
      note: `Auto-send held on an error, so the draft waits for a person: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    };
  }
}

async function runAutoSend(
  service: SupabaseClient,
  input: {
    organizationId: string;
    draftId: string;
    relationshipId: string;
    gate: {
      verdict: "pass" | "bounce" | "error";
      confidence: number | null;
      grade: number | null;
      hardOverride: boolean;
      reasons: string[];
    };
  },
): Promise<AutoSendOutcome> {
  const { organizationId, draftId, relationshipId, gate } = input;

  // ---- Fact: the graduated authority for this message type. ---------------
  const authorityRes = await service
    .from("voice_gate_authority")
    .select("id, autonomy_state")
    .eq("organization_id", organizationId)
    .eq("message_type", SCOUT_FIRST_INTRO_MESSAGE_TYPE)
    .maybeSingle();
  if (authorityRes.error) throw new Error(authorityRes.error.message);
  const authorityRow = (authorityRes.data ?? null) as Record<string, unknown> | null;
  const autonomyStateRaw = str(authorityRow?.["autonomy_state"]);
  const autonomyState =
    autonomyStateRaw === "auto_send" ? "auto_send" : autonomyStateRaw === "bounce_only" ? "bounce_only" : null;

  // ---- Fact: the relationship's prior-contact history. --------------------
  const anyMsgRes = await service
    .from("comms_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId);
  if (anyMsgRes.error) throw new Error(anyMsgRes.error.message);
  const hasAnyPriorMessage = (anyMsgRes.count ?? 0) > 0;

  const inboundRes = await service
    .from("comms_messages")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("relationship_id", relationshipId)
    .eq("direction", "inbound");
  if (inboundRes.error) throw new Error(inboundRes.error.message);
  const hasInboundReply = (inboundRes.count ?? 0) > 0;

  // ---- The pure decision. -------------------------------------------------
  const verdict: AutoSendVerdict = decideAutoSend({
    authority: {
      autonomyState,
      authorityId: authorityRow ? str(authorityRow["id"]) : null,
    },
    gate: {
      verdict: gate.verdict,
      confidence: gate.confidence,
      grade: gate.grade,
      hardOverride: gate.hardOverride,
      reasons: gate.reasons,
    },
    relationship: { hasAnyPriorMessage, hasInboundReply },
    confidenceFloor: CONFIDENCE_FLOOR,
    /* The scout draft path's pass is the deterministic checkVoice, which is
       blocking-clean by construction and produces no score. Only that path may
       vouch a null confidence as acceptable. */
    allowMissingConfidence: gate.confidence === null,
  });

  if (!verdict.autoSend) {
    await recordTelemetry(service, organizationId, draftId, {
      decision: "queue",
      hold: verdict.code,
      message: verdict.message,
    });
    return { attempted: false, hold: verdict.code, note: verdict.message };
  }

  // ---- Auto-send. Build exactly what would go out, then prove it. ---------
  const creds = resendCredentials();
  if (!creds) {
    await recordTelemetry(service, organizationId, draftId, {
      decision: "queue",
      hold: "server_not_configured",
      message: "Email sending is not configured, so the graduated draft waits for a person.",
    });
    return {
      attempted: false,
      hold: "server_not_configured",
      note: "Email sending is not configured, so the graduated draft waits for a person.",
    };
  }

  const payload = await buildPayload(service, organizationId, draftId, creds.from);
  const fingerprint = outboundFingerprint(payload);

  // Write the system approval FIRST — the provable record the send will rest on.
  const approval = await writeSystemApproval(service, {
    organizationId,
    draftId,
    relationshipId,
    fingerprint,
    payload,
    authorityId: authorityRow ? str(authorityRow["id"]) : null,
    autonomyState: "auto_send",
    gate,
    preconditions: { hasAnyPriorMessage, hasInboundReply, autonomyState: "auto_send" },
  });

  // The same rule every door asks, now satisfied by the SYSTEM approval. A
  // system sender is the service role acting on Tai's graduated authority, so
  // callerMaySend is true; the payload fingerprint is still the whole binding.
  const decision = decideSend({
    missingCapability: [],
    approval: null,
    run: null,
    blockers: [],
    currentContextRevision: null,
    currentContextFingerprint: "",
    currentVersionId: null,
    payloadFingerprint: fingerprint,
    callerMaySend: true,
    systemApproval: {
      id: approval.id,
      approvedPayloadFingerprint: approval.payloadFingerprint,
      authorityState: "auto_send",
      revokedAt: null,
    },
  });
  if (!decision.allowed) {
    await recordTelemetry(service, organizationId, draftId, {
      decision: "queue",
      hold: decision.code,
      message: decision.message,
    });
    return { attempted: false, hold: decision.code, note: decision.message };
  }

  // Claim on the SYSTEM delivery ledger (not the human one). Its DB claim guard
  // re-checks the approval covers this draft, payload and channel and is not
  // revoked. A retry, a double fire and a racing run all land on one row.
  const claim = await claimAutoSendDelivery(service, {
    organizationId,
    draftId,
    approvalId: approval.id,
    fingerprint,
    channel: "email_resend",
  });
  if (!claim.fresh) {
    return { attempted: false, state: "duplicate", note: claim.note };
  }

  // From here a real message may exist in the world. The SAME provider helper
  // the human path uses, handed exactly the payload the approval was over.
  const result = await postToResend(creds, payload);
  const settled = await settleAutoSendDelivery(service, {
    organizationId,
    deliveryId: claim.id,
    state: result.state,
    providerMessageId: result.providerMessageId,
    error: result.detail,
  });

  await recordTelemetry(service, organizationId, draftId, {
    decision: "auto_send",
    state: result.state,
    approvalId: approval.id,
    fingerprint,
    message: settled.note,
  });

  // On a confirmed send, mark the draft sent so it leaves the review queue —
  // the same end state a human send reaches, reached honestly by the system.
  if (result.state === "sent") {
    await service
      .from("comms_drafts")
      .update({ review_state: "sent", updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .eq("organization_id", organizationId)
      .in("review_state", ["needs_human_review", "sending"]);
  }

  return { attempted: true, state: result.state, note: settled.note };
}

/** Build the outbound payload for this draft, as the provider will be handed it. */
async function buildPayload(
  service: SupabaseClient,
  organizationId: string,
  draftId: string,
  from: string,
): Promise<OutboundPayload> {
  const draftRes = await service
    .from("comms_drafts")
    .select("id, subject, body, relationship_id")
    .eq("id", draftId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (draftRes.error) throw new Error(draftRes.error.message);
  const draft = (draftRes.data ?? null) as Record<string, unknown> | null;
  if (!draft) throw new Error("The draft to auto-send is not on record.");

  const relId = str(draft["relationship_id"]);
  const relRes = await service
    .from("comms_relationships")
    .select("id, email")
    .eq("id", relId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (relRes.error) throw new Error(relRes.error.message);
  const email = str((relRes.data as Record<string, unknown> | null)?.["email"]);
  if (!email) throw new Error("This person has no email on record, so nothing was auto-sent.");

  return {
    channel: "email_resend",
    subject: typeof draft["subject"] === "string" ? (draft["subject"] as string) : null,
    body: str(draft["body"]),
    recipient: email,
    senderIdentity: from,
    /* A Scout first intro carries no attachments; the fingerprint is over an
       empty list, and the send path adds none. */
    attachments: [],
    cc: [],
    bcc: [],
  };
}

/** Write the system approval, or return the one a retry already wrote. */
async function writeSystemApproval(
  service: SupabaseClient,
  input: {
    organizationId: string;
    draftId: string;
    relationshipId: string;
    fingerprint: string;
    payload: OutboundPayload;
    authorityId: string | null;
    autonomyState: "auto_send";
    gate: { verdict: string; confidence: number | null; grade: number | null; reasons: string[] };
    preconditions: Record<string, unknown>;
  },
): Promise<{ id: string; payloadFingerprint: string }> {
  const row = {
    organization_id: input.organizationId,
    draft_id: input.draftId,
    relationship_id: input.relationshipId,
    message_type: SCOUT_FIRST_INTRO_MESSAGE_TYPE,
    payload_fingerprint: input.fingerprint,
    payload_channel: "email_resend",
    authority_id: input.authorityId,
    authority_state: input.autonomyState,
    gate_verdict: input.gate.verdict,
    gate_grade: input.gate.grade,
    gate_confidence: input.gate.confidence,
    gate_reasons: input.gate.reasons,
    preconditions: input.preconditions,
    approved_by_system: "voice_gate_authority",
  };
  const { data, error } = await service
    .from("comms_autosend_approvals")
    .insert(row)
    .select("id, payload_fingerprint")
    .maybeSingle();
  if (!error && data) {
    const created = data as Record<string, unknown>;
    return { id: str(created["id"]), payloadFingerprint: str(created["payload_fingerprint"]) };
  }
  // A retry lands on the (org, draft, fingerprint) unique constraint. Read the
  // existing approval and reuse it — never a second approval for the same words.
  if (error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
    const existing = await service
      .from("comms_autosend_approvals")
      .select("id, payload_fingerprint")
      .eq("organization_id", input.organizationId)
      .eq("draft_id", input.draftId)
      .eq("payload_fingerprint", input.fingerprint)
      .maybeSingle();
    const found = (existing.data ?? null) as Record<string, unknown> | null;
    if (found) {
      return { id: str(found["id"]), payloadFingerprint: str(found["payload_fingerprint"]) };
    }
  }
  throw new Error(
    `The auto-send approval could not be written, so nothing was sent: ${error?.message ?? "no row returned"}`,
  );
}

interface AutoSendClaim {
  fresh: boolean;
  id: string;
  note: string;
}

/** Claim the system attempt before the provider is asked anything. */
async function claimAutoSendDelivery(
  service: SupabaseClient,
  input: {
    organizationId: string;
    draftId: string;
    approvalId: string;
    fingerprint: string;
    channel: "email_resend";
  },
): Promise<AutoSendClaim> {
  const key = deliveryKey(input.draftId, input.fingerprint);
  const { data, error } = await service
    .from("comms_autosend_deliveries")
    .insert({
      organization_id: input.organizationId,
      draft_id: input.draftId,
      approval_id: input.approvalId,
      channel: input.channel,
      payload_fingerprint: input.fingerprint,
      idempotency_key: key,
      status: "attempting",
      attempted_at: new Date().toISOString(),
    })
    .select("id, status")
    .maybeSingle();
  if (!error && data) {
    const row = data as Record<string, unknown>;
    const id = str(row["id"]);
    if (!id) throw new Error("The auto-send attempt was accepted but returned no identifier.");
    return { fresh: true, id, note: "Auto-send attempt recorded." };
  }
  if (error && (error.code === "23505" || /duplicate key/i.test(error.message ?? ""))) {
    const existing = await service
      .from("comms_autosend_deliveries")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();
    const row = (existing.data ?? null) as Record<string, unknown> | null;
    if (row) {
      const state = (str(row["status"]) || "attempting") as DeliveryState;
      return {
        fresh: false,
        id: str(row["id"]),
        note:
          state === "sent"
            ? "This was already auto-sent. Nothing was sent again."
            : state === "unknown"
              ? describeDelivery("unknown", input.channel)
              : "This auto-send is already in progress. Nothing was sent twice.",
      };
    }
  }
  throw new Error(
    `The auto-send attempt could not be recorded, so it was not attempted: ${error?.message ?? "no row"}`,
  );
}

/** Write down what actually happened, over an attempt still in flight only. */
async function settleAutoSendDelivery(
  service: SupabaseClient,
  input: {
    organizationId: string;
    deliveryId: string;
    state: "sent" | "failed" | "unknown";
    providerMessageId: string | null;
    error: string | null;
  },
): Promise<{ recorded: boolean; note: string }> {
  const { data, error } = await service
    .from("comms_autosend_deliveries")
    .update({
      status: input.state,
      settled_at: new Date().toISOString(),
      provider_message_id: input.providerMessageId,
      error_detail: input.error,
    })
    .eq("id", input.deliveryId)
    .eq("organization_id", input.organizationId)
    .eq("status", "attempting")
    .select("id, status");
  if (error) {
    return {
      recorded: false,
      note:
        input.state === "sent"
          ? `The message went out, but the outcome could not be recorded (${error.message}). Treat it as sent and reconcile by hand.`
          : `The auto-send outcome could not be recorded (${error.message}). Reconcile by hand.`,
    };
  }
  const rows = (data ?? []) as unknown[];
  if (rows.length !== 1) {
    return { recorded: false, note: "The auto-send attempt was no longer open when its outcome arrived." };
  }
  return { recorded: true, note: describeDelivery(input.state, "email_resend") };
}

/**
 * Honest auto-send telemetry, written to the draft's own rationale — never to
 * voice_gate_feedback. This says what the system decided and why, so the audit
 * surface can show a machine send apart from a human one, without ever forging
 * a human-approval learning signal.
 */
async function recordTelemetry(
  service: SupabaseClient,
  organizationId: string,
  draftId: string,
  telemetry: Record<string, unknown>,
): Promise<void> {
  try {
    const { data } = await service
      .from("comms_drafts")
      .select("rationale")
      .eq("id", draftId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    const rationale = ((data as Record<string, unknown> | null)?.["rationale"] as
      | Record<string, unknown>
      | null) ?? {};
    await service
      .from("comms_drafts")
      .update({
        rationale: { ...rationale, autosend: { ...telemetry, at: new Date().toISOString() } },
      })
      .eq("id", draftId)
      .eq("organization_id", organizationId);
  } catch {
    /* Telemetry is downstream of the decision; never let it change an outcome. */
  }
}
