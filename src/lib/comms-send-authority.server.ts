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
  userId: string;
  role: string;
  maySend: boolean;
}

export async function identifySender(
  token: string,
  organizationId: string,
): Promise<SendCaller> {
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
  return { client, userId: data.user.id, role, maySend: SENDING_ROLES.has(role) };
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
): Promise<SendReadiness> {
  const fingerprint = outboundFingerprint(input.payload);
  const refuse = (missing: string[]): SendReadiness => ({
    decision: decideSend({
      missingCapability: missing,
      approval: null,
      run: null,
      blockers: [],
      currentContextRevision: null,
      currentContextFingerprint: "",
      payloadFingerprint: fingerprint,
      callerMaySend: caller.maySend,
    }),
    payload: input.payload,
    fingerprint,
  });

  /* Which review covers this draft? Until the binding column exists there is
     no honest answer, and no answer means no send. */
  const sessionRes = await caller.client
    .from("comms_review_sessions")
    .select("id, context_revision, status")
    .eq("organization_id", input.organizationId)
    .eq("draft_id", input.draftId)
    .maybeSingle();
  if (missingSchema(sessionRes.error)) {
    return refuse([
      "comms_review_sessions has no draft_id, so no review can be tied to this draft.",
    ]);
  }
  if (sessionRes.error) {
    throw new SendRefused(
      "review_unreadable",
      "The review behind this message could not be read, so nothing was sent.",
    );
  }
  const session = (sessionRes.data ?? null) as Row | null;

  const approvalRes = await caller.client
    .from("comms_review_approvals")
    .select("id, run_id, version_id, payload_fingerprint, context_fingerprint, context_revision")
    .eq("organization_id", input.organizationId)
    .eq("session_id", session ? str(session["id"]) : "")
    .order("approved_at", { ascending: false })
    .limit(1);
  if (missingSchema(approvalRes.error)) {
    return refuse([
      "comms_review_approvals does not record the exact payload it approved, so an edited message cannot be told apart from the approved one.",
    ]);
  }
  if (!session) {
    return {
      decision: decideSend({
        missingCapability: [],
        approval: null,
        run: null,
        blockers: [],
        currentContextRevision: null,
        currentContextFingerprint: "",
        payloadFingerprint: fingerprint,
        callerMaySend: caller.maySend,
      }),
      payload: input.payload,
      fingerprint,
    };
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

  let run: { id: string; status: string; contextRevision: number | null } | null = null;
  /* The context the review actually judged, as the review itself recorded it.
     Comparing the approval against this is real evidence; comparing it against
     itself would prove nothing. Whether that context is still current is a
     separate question, answered by the revision the database maintains on the
     session whenever a version, a source or the goal changes. */
  let runContextFingerprint = "";
  if (approval) {
    const runRes = await caller.client
      .from("comms_review_runs")
      .select("id, status, context_revision, context_fingerprint")
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
    if (runRow) {
      runContextFingerprint = str(runRow["context_fingerprint"]);
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
      .select("severity, summary")
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
      blockers.push(str(row["summary"]) || "Something the review said must be fixed.");
    }
  }

  return {
    decision: decideSend({
      missingCapability: [],
      approval,
      run,
      blockers,
      currentContextRevision: nullableNum(session["context_revision"]),
      currentContextFingerprint: runContextFingerprint,
      payloadFingerprint: fingerprint,
      callerMaySend: caller.maySend,
    }),
    payload: input.payload,
    fingerprint,
  };
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
  id: string | null;
  state: DeliveryState;
  note: string;
}

/**
 * Claim the attempt before the provider is asked anything. The key is the
 * draft plus the approved payload, and the database holds it unique, so a
 * double click, a retry and a scheduled run racing each other all land on the
 * same row and only one of them gets to send.
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
    /* Unique violation: somebody already claimed this exact payload. */
    const existing = await writer
      .from("comms_review_deliveries")
      .select("id, status")
      .eq("organization_id", input.organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();
    const row = (existing.data ?? null) as Row | null;
    const state = (str(row?.["status"]) || "attempting") as DeliveryState;
    return {
      fresh: false,
      id: row ? str(row["id"]) : null,
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
  return {
    fresh: true,
    id: row ? str(row["id"]) : null,
    state: "attempting",
    note: "Attempt recorded.",
  };
}

/**
 * Write down what actually happened. If the receipt itself cannot be stored
 * after the provider accepted the message, the attempt is left as unknown and
 * says so — losing the receipt is not permission to send again.
 */
export async function settleDelivery(input: {
  organizationId: string;
  deliveryId: string;
  state: DeliveryState;
  channel: DeliveryChannel;
  providerMessageId?: string | null;
  error?: string | null;
}): Promise<{ recorded: boolean; note: string }> {
  const writer = writerClient();
  const { error } = await writer
    .from("comms_review_deliveries")
    .update({
      status: input.state,
      settled_at: new Date().toISOString(),
      provider_message_id: input.providerMessageId ?? null,
      error_detail: input.error ?? null,
    })
    .eq("id", input.deliveryId)
    .eq("organization_id", input.organizationId);
  if (error) {
    return {
      recorded: false,
      note:
        input.state === "sent"
          ? "The message went out, but the record of it could not be saved. Treat this as sent and check before sending anything else."
          : "The outcome could not be recorded.",
    };
  }
  return { recorded: true, note: describeDelivery(input.state, input.channel) };
}
