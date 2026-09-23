/**
 * The one gate every send passes through (server only).
 *
 * `src/domain/comms-delivery.ts` holds the rule. This module gathers the
 * facts the rule needs, honestly, from the database — and then owns the
 * attempt: one row written before the provider is called, one receipt written
 * after, and an outcome of "unknown" whenever the provider was asked and the
 * answer never arrived. Nothing here retries anything on its own.
 *
 * Authority: reads run as the caller, under RLS, always filtered to the exact
 * workspace named in the request. The attempt rows are written with the
 * server's own credentials, and only after the caller has been proved an
 * active member with a sending role. A browser cannot write them.
 *
 * Where the database cannot yet answer the rule's questions — today it cannot
 * tie a draft to the review that approved it — this gate refuses. Refusing is
 * the safe direction: a message nobody can prove was approved does not leave.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import {
  decideSend,
  deliveryKey,
  describeDelivery,
  outboundFingerprint,
  type DeliveryChannel,
  type DeliveryState,
  type OutboundPayload,
  type SendDecision,
} from "@/domain/comms-delivery";
import { currentReviewContext } from "@/lib/comms-review.server";
import { trustTaiSupabaseKey, trustTaiSupabaseUrl } from "@/lib/trust-tai-backend.server";

type Row = Record<string, unknown>;

const SENDING_ROLES = new Set(["owner", "admin"]);

export class SendRefused extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly blockers: string[] = [],
  ) {
    super(message);
    this.name = "SendRefused";
  }
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function nullableNum(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

/** The caller, proved: a live session and an active membership of this workspace. */
export interface SendCaller {
  client: SupabaseClient;
  /** The caller's own token, so shared review reads run as them too. */
  token: string;
  userId: string;
  role: string;
  maySend: boolean;
}

export async function identifySender(token: string, organizationId: string): Promise<SendCaller> {
  const client = createClient(trustTaiSupabaseUrl(), trustTaiSupabaseKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    throw new SendRefused("access_denied", "You are not signed in, so nothing was sent.");
  }
  const membership = await client
    .from("organization_memberships")
    .select("role, status")
    .eq("organization_id", organizationId)
    .eq("user_id", data.user.id)
    .maybeSingle();
  const row = (membership.data ?? null) as Row | null;
  if (membership.error || !row || str(row["status"]) !== "active") {
    throw new SendRefused(
      "access_denied",
      "You are not an active member of this workspace, so nothing was sent.",
    );
  }
  const role = str(row["role"]);
  return { client, token, userId: data.user.id, role, maySend: SENDING_ROLES.has(role) };
}

/** Server credentials, for the attempt record only. Never a browser fallback. */
function writerClient(): SupabaseClient {
  const key =
    process.env["TRUST_TAI_SUPABASE_SERVICE_KEY"] ?? process.env["SUPABASE_SERVICE_ROLE_KEY"];
  if (!key) {
    throw new SendRefused(
      "server_not_configured",
      "Sending is not configured on the server, so nothing was sent and nothing was recorded.",
    );
  }
  return createClient(trustTaiSupabaseUrl(), key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Postgres says 42703 when a column does not exist and 42P01 when a table
 * does not. Either means the rule cannot be answered here yet, which is a
 * missing capability, not a missing approval — and the difference matters to
 * whoever has to fix it.
 */
function missingSchema(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "42703" || code === "42P01") return true;
  return /does not exist/i.test(error.message ?? "");
}

export interface SendReadiness {
  decision: SendDecision;
  payload: OutboundPayload;
  fingerprint: string;
}

/**
 * Ask the one question: may this exact message go out of this exact door?
 *
 * Everything the rule needs is read here with the caller's own token. The
 * draft's stored `review_state` is deliberately not consulted: any member can
 * write it, so it is a UI hint, never permission.
 */
export async function reviewReadinessForSend(
  caller: SendCaller,
  input: { organizationId: string; draftId: string; payload: OutboundPayload },
  deps: {
    /** Recomputes the context as it stands now. Injected so tests can drive it. */
    currentContext?: typeof currentReviewContext;
  } = {},
): Promise<SendReadiness> {
  const currentContextFor = deps.currentContext ?? currentReviewContext;
  const fingerprint = outboundFingerprint(input.payload);
  const decide = (
    extra: Partial<Parameters<typeof decideSend>[0]> & { missingCapability?: string[] },
  ): SendReadiness => ({
    decision: decideSend({
      missingCapability: [],
      approval: null,
      run: null,
      blockers: [],
      currentContextRevision: null,
      currentContextFingerprint: "",
      currentVersionId: null,
      payloadFingerprint: fingerprint,
      callerMaySend: caller.maySend,
      ...extra,
    }),
    payload: input.payload,
    fingerprint,
  });

  /* Which review covers this draft? Closed reviews are not answers, and two
     open ones are not an answer either. Until the binding column exists
     there is no honest answer at all, and no answer means no send. */
  const sessionRes = await caller.client
    .from("comms_review_sessions")
    .select("id, context_revision, status, draft_id, intended_channel, sender_identity")
    .eq("organization_id", input.organizationId)
    .eq("draft_id", input.draftId)
    .neq("status", "closed");
  if (missingSchema(sessionRes.error)) {
    return decide({
      missingCapability: [
        "comms_review_sessions has no draft_id, so no review can be tied to this draft.",
      ],
    });
  }
  if (sessionRes.error) {
    throw new SendRefused(
      "review_unreadable",
      "The review behind this message could not be read, so nothing was sent.",
    );
  }
  const sessions = (sessionRes.data ?? []) as Row[];
  if (sessions.length > 1) return decide({ ambiguousReview: true });
  const session = sessions[0] ?? null;
  if (!session) return decide({});
  const sessionId = str(session["id"]);

  const approvalRes = await caller.client
    .from("comms_review_approvals")
    .select(
      "id, session_id, run_id, version_id, payload_fingerprint, payload_channel, context_fingerprint, context_revision",
    )
    .eq("organization_id", input.organizationId)
    .eq("session_id", sessionId)
    .order("approved_at", { ascending: false })
    .limit(1);
  if (missingSchema(approvalRes.error)) {
    return decide({
      missingCapability: [
        "comms_review_approvals does not record the exact payload it approved, so an edited message cannot be told apart from the approved one.",
      ],
    });
  }
  if (approvalRes.error) {
    throw new SendRefused(
      "review_unreadable",
      "The approval behind this message could not be read, so nothing was sent.",
    );
  }
  const approvalRow = ((approvalRes.data ?? []) as Row[])[0] ?? null;
  const approval = approvalRow
    ? {
        id: str(approvalRow["id"]),
        runId: str(approvalRow["run_id"]),
        versionId: str(approvalRow["version_id"]),
        approvedPayloadFingerprint: str(approvalRow["payload_fingerprint"]),
        contextFingerprint: str(approvalRow["context_fingerprint"]),
        contextRevision: nullableNum(approvalRow["context_revision"]),
      }
    : null;
  /* An approval that names another review is not this message's approval. */
  if (approvalRow && str(approvalRow["session_id"]) !== sessionId) {
    return decide({});
  }

  let run: { id: string; status: string; contextRevision: number | null } | null = null;
  if (approval) {
    const runRes = await caller.client
      .from("comms_review_runs")
      .select("id, session_id, version_id, status, context_revision, context_fingerprint")
      .eq("organization_id", input.organizationId)
      .eq("id", approval.runId)
      .maybeSingle();
    if (runRes.error) {
      throw new SendRefused(
        "review_unreadable",
        "The review behind this approval could not be read, so nothing was sent.",
      );
    }
    const runRow = (runRes.data ?? null) as Row | null;
    /* The run must be this review's run, of this approval's version. A run
       borrowed from another session or another version proves nothing. */
    if (
      runRow &&
      str(runRow["session_id"]) === sessionId &&
      str(runRow["version_id"]) === approval.versionId
    ) {
      run = {
        id: str(runRow["id"]),
        status: str(runRow["status"]),
        contextRevision: nullableNum(runRow["context_revision"]),
      };
    }
  }

  /* Anything the review still holds against this message. Findings that must
     be fixed are blockers whatever anybody marked them. */
  const blockers: string[] = [];
  if (approval && run) {
    const findingRes = await caller.client
      .from("comms_review_findings")
      .select("severity, why")
      .eq("organization_id", input.organizationId)
      .eq("run_id", run.id)
      .eq("severity", "must_fix");
    if (findingRes.error) {
      throw new SendRefused(
        "review_unreadable",
        "What the review raised could not be read, so nothing was sent.",
      );
    }
    for (const row of (findingRes.data ?? []) as Row[]) {
      blockers.push(str(row["why"]) || "Something the review said must be fixed.");
    }
  }

  /* The context as it stands NOW — recomputed from the current version, the
     current sources, the situation, the verified author and the stored voice
     rules. Comparing an approval against a fingerprint the run stored about
     itself would never notice a voice rule edited afterwards. */
  let current: {
    fingerprint: string;
    revision: number;
    currentVersionId: string | null;
  };
  try {
    current = await currentContextFor(caller.token, {
      organizationId: input.organizationId,
      sessionId,
    });
  } catch {
    throw new SendRefused(
      "review_unreadable",
      "The review behind this message could not be read as it stands now, so nothing was sent.",
    );
  }

  return decide({
    approval,
    run,
    blockers,
    currentContextRevision: current.revision,
    currentContextFingerprint: current.fingerprint,
    currentVersionId: current.currentVersionId,
  });
}

/**
 * Refuse loudly, or hand back the approval this send is allowed to use. Every
 * dispatch boundary calls this immediately before touching a provider, and a
 * refusal means zero provider calls — not a call that is ignored afterwards.
 */
export async function requireSendApproval(
  token: string,
  input: { organizationId: string; draftId: string; payload: OutboundPayload },
): Promise<{ caller: SendCaller; approvalId: string; fingerprint: string }> {
  const caller = await identifySender(token, input.organizationId);
  const readiness = await reviewReadinessForSend(caller, input);
  if (!readiness.decision.allowed) {
    throw new SendRefused(
      readiness.decision.code,
      readiness.decision.message,
      readiness.decision.blockers,
    );
  }
  return {
    caller,
    approvalId: readiness.decision.approvalId,
    fingerprint: readiness.fingerprint,
  };
}

/* ---------------------------------------------------------------- attempts */

export interface DeliveryClaim {
  /** False when this exact attempt is already on record: do not call the provider. */
  fresh: boolean;
  id: string;
  state: DeliveryState;
  note: string;
}

/** Postgres's unique violation. The only insert failure that means "already claimed". */
function uniqueViolation(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "23505" || /duplicate key value/i.test(error.message ?? "");
}

/**
 * Claim the attempt before the provider is asked anything. The key is the
 * draft plus the approved payload, and the database holds it unique, so a
 * double click, a retry and a scheduled run racing each other all land on the
 * same row and only one of them gets to send.
 *
 * Only a unique violation whose existing row really is this same attempt
 * counts as a replay. Every other failure to record the claim stops the send:
 * a send that cannot be written down can be sent twice.
 */
export async function claimDelivery(input: {
  organizationId: string;
  draftId: string;
  approvalId: string;
  fingerprint: string;
  channel: DeliveryChannel;
  userId: string;
}): Promise<DeliveryClaim> {
  const writer = writerClient();
  const key = deliveryKey(input.draftId, input.fingerprint);
  const { data, error } = await writer
    .from("comms_review_deliveries")
    .insert({
      organization_id: input.organizationId,
      draft_id: input.draftId,
      approval_id: input.approvalId,
      channel: input.channel,
      payload_fingerprint: input.fingerprint,
      idempotency_key: key,
      status: "attempting",
      attempted_at: new Date().toISOString(),
      attempted_by: input.userId,
    })
    .select("id, status")
    .maybeSingle();

  if (error) {
    if (missingSchema(error)) {
      throw new SendRefused(
        "capability_missing",
        "Sending is held because attempts cannot be recorded yet, and an unrecorded send could be sent twice. Nothing was sent.",
        ["The comms_review_deliveries table does not exist yet."],
      );
    }
    if (!uniqueViolation(error)) {
      throw new SendRefused(
        "delivery_unrecorded",
        "This send could not be written down before it was attempted, so it was not attempted. Nothing was sent.",
        [error.message ?? "The attempt could not be recorded."],
      );
    }
    /* A unique violation only means "already claimed" if the row that is
       there really is this same attempt — same draft, same approval, same
       payload, same door. Anything else is a key collision we must not treat
       as a send that already happened. */
    const existing = await writer
      .from("comms_review_deliveries")
      .select("id, status, draft_id, approval_id, payload_fingerprint, channel")
      .eq("organization_id", input.organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();
    const row = (existing.data ?? null) as Row | null;
    const matches =
      row !== null &&
      str(row["draft_id"]) === input.draftId &&
      str(row["approval_id"]) === input.approvalId &&
      str(row["payload_fingerprint"]) === input.fingerprint &&
      str(row["channel"]) === input.channel;
    if (existing.error || !matches) {
      throw new SendRefused(
        "delivery_unrecorded",
        "This send could not be claimed, and the attempt already on record is not this one. Nothing was sent. Someone needs to look at the delivery record before trying again.",
        [existing.error?.message ?? "The existing attempt does not match this message."],
      );
    }
    const state = (str(row["status"]) || "attempting") as DeliveryState;
    return {
      fresh: false,
      id: str(row["id"]),
      state,
      note:
        state === "sent"
          ? "This was already sent. Nothing was sent again."
          : state === "unknown"
            ? describeDelivery("unknown", input.channel)
            : "This send is already in progress. Nothing was sent twice.",
    };
  }
  const row = (data ?? null) as Row | null;
  const id = row ? str(row["id"]) : "";
  if (!id) {
    /* No row came back, so there is nothing to settle against later. Refuse
       rather than send something we cannot account for. */
    throw new SendRefused(
      "delivery_unrecorded",
      "This send could not be written down before it was attempted, so it was not attempted. Nothing was sent.",
      ["The delivery record was accepted but returned no identifier."],
    );
  }
  return { fresh: true, id, state: "attempting", note: "Attempt recorded." };
}

/**
 * Ask the same question again, after the attempt has been claimed and before
 * the provider is touched.
 *
 * The check before the claim can be overtaken: a writing habit kept or
 * stopped in that gap changes the context fingerprint, so the approval no
 * longer covers what would go out. This closes that window — the claim is
 * settled as failed, nothing is handed to a provider, and the refusal says
 * what changed.
 */
export async function requireCurrentContextAfterClaim(
  caller: SendCaller,
  input: {
    organizationId: string;
    draftId: string;
    payload: OutboundPayload;
    deliveryId: string;
    channel: DeliveryChannel;
  },
  deps: { currentContext?: typeof currentReviewContext } = {},
): Promise<void> {
  let recheck: SendReadiness;
  try {
    recheck = await reviewReadinessForSend(
      caller,
      { organizationId: input.organizationId, draftId: input.draftId, payload: input.payload },
      deps,
    );
  } catch (error) {
    await settleDelivery({
      organizationId: input.organizationId,
      deliveryId: input.deliveryId,
      state: "failed",
      channel: input.channel,
      error: (error as Error).message,
    });
    throw error;
  }
  if (recheck.decision.allowed) return;
  await settleDelivery({
    organizationId: input.organizationId,
    deliveryId: input.deliveryId,
    state: "failed",
    channel: input.channel,
    error: recheck.decision.message,
  });
  throw new SendRefused(
    recheck.decision.code,
    `${recheck.decision.message} This changed while the send was being recorded, so nothing was sent.`,
    recheck.decision.blockers,
  );
}

/**

 * Write down what actually happened, and only over an attempt that is still
 * in flight: a settled attempt is never rewritten. If the receipt cannot be
 * stored after the provider accepted the message, that is said plainly and
 * the attempt needs a person, not a retry.
 */
export async function settleDelivery(input: {
  organizationId: string;
  deliveryId: string;
  state: Exclude<DeliveryState, "attempting">;
  channel: DeliveryChannel;
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<{ recorded: boolean; note: string }> {
  const writer = writerClient();
  const unstored = (detail: string) => ({
    recorded: false,
    note:
      input.state === "sent"
        ? `The message went out, but the outcome could not be recorded (${detail}). Treat it as sent, check the recipient's thread, and do not send it again until the record is reconciled.`
        : `The outcome could not be recorded (${detail}). This attempt needs reconciling by hand before anything is sent again.`,
  });

  const { data, error } = await writer
    .from("comms_review_deliveries")
    .update({
      status: input.state,
      settled_at: new Date().toISOString(),
      provider_message_id: input.providerMessageId ?? null,
      error_detail: input.error ?? null,
    })
    .eq("id", input.deliveryId)
    .eq("organization_id", input.organizationId)
    // Only a claim still in flight may be settled; never a settled one again.
    .eq("status", "attempting")
    .select("id, status");
  if (error) return unstored(error.message);
  const rows = (data ?? []) as Row[];
  if (rows.length !== 1) {
    return unstored(
      rows.length === 0
        ? "the attempt was no longer open, or no longer belongs to this workspace"
        : "more than one attempt matched",
    );
  }
  if (input.state === "sent") await closeReviewAfterSend(input.organizationId, input.deliveryId);
  if (input.state === "sent") {
    const { completeScoutTaskAfterSentDelivery } = await import(
      "@/lib/comms-scout-task-completion.server"
    );
    // The provider result and delivery receipt remain authoritative even when
    // this downstream reconciliation cannot finish. Never invite a resend.
    await completeScoutTaskAfterSentDelivery({
      client: writer,
      organizationId: input.organizationId,
      deliveryId: input.deliveryId,
    }).catch(() => undefined);
  }
  return { recorded: true, note: describeDelivery(input.state, input.channel) };
}

/**
 * Once a message has actually gone out, the review that authorised it is
 * finished. Closing it matters for a practical reason: the database reopens
 * and re-dates any live review of a draft that changes, and a draft changes
 * when it is marked as sent. Without this, a delivered message would leave
 * behind a review that looks reopened and unapproved. A failure to close is
 * not a failure to send, so it is logged and left alone.
 */
async function closeReviewAfterSend(organizationId: string, deliveryId: string): Promise<void> {
  const writer = writerClient();
  const { data } = await writer
    .from("comms_review_deliveries")
    .select("draft_id")
    .eq("id", deliveryId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  const draftId = data ? str((data as Row)["draft_id"]) : "";
  if (!draftId) return;
  await writer
    .from("comms_review_sessions")
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("draft_id", draftId)
    .neq("status", "closed");
}
