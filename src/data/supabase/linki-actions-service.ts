/**
 * Governed LinkedIn actions — the service layer.
 *
 * The single funnel every approved-LinkedIn-action write passes through:
 * create (draft from Comms, pending Tai's approval) → approve (human boundary)
 * → execute (Linki transport, approver-only) → executed/failed. Every
 * transition is validated against the state machine and appended to the
 * shared activity stream with actor + before/after + receipt hash.
 *
 * Law:
 *   - Nothing in this file sends anything by itself. `execute` is the ONLY
 *     path that hands an action to Linki, and it refuses unless the row is
 *     `approved` AND the caller is the approver AND the kill switch is on.
 *   - A failed action is terminal. `retry` creates a NEW row referencing the
 *     original; the original is never re-executed in place.
 *   - Daily caps are checked at CREATE (before Tai is asked to approve) and
 *     again at EXECUTE — the cap can be hit between those moments.
 */

import { createHash } from "node:crypto";

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ActivityStream } from "@/domain/activity";
import type { ID } from "@/domain/entities";
import {
  canTransition,
  CAP_COUNTED_STATUSES,
  LinkiActionError,
  linkiActionErrorStatus,
  linkiDailyCap,
  linkiExecutionEnabled,
  type ApprovedLinkedInAction,
  type LinkiActionStatus,
  type LinkiActionType,
  type LinkiExecutionReceipt,
} from "@/domain/linki-actions";
import type { LinkiSendInput } from "@/lib/linki-execution.server";

type Env = Record<string, string | undefined>;

/** Seam for tests: the transport is injected, never imported here. */
export type LinkiTransport = (input: LinkiSendInput, env?: Env) => Promise<{
  receipt: LinkiExecutionReceipt;
}>;

export interface LinkiActionContext {
  organizationId: ID;
  userId: ID;
}

/** Stable hash of a receipt for the audit trail (never the full payload). */
export function receiptHash(receipt: LinkiExecutionReceipt | null): string | null {
  if (!receipt) return null;
  const material = `${receipt.provider}:${receipt.runId}:${receipt.sentAt}`;
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

/* ------------------------------------------------------------------ */
/* Row mapping (schema owned by the migration, snake_case in Postgres) */
/* ------------------------------------------------------------------ */

type Row = Record<string, unknown>;

export interface LinkiActionRow {
  id: string;
  organization_id: string;
  prospect_id: string;
  person_id: string;
  contact_id: string;
  action_type: string;
  draft_body: string;
  channel_context: Row | null;
  status: string;
  idempotency_key: string;
  execution_receipt: LinkiExecutionReceipt | null;
  failure_reason: string | null;
  created_by: string;
  approved_at: string | null;
  approved_by: string | null;
  executed_at: string | null;
  parent_action_id: string | null;
  created_at: string;
  updated_at: string;
}

export const LINKI_ACTION_COLUMNS =
  "id, organization_id, prospect_id, person_id, contact_id, action_type, draft_body, channel_context, status, idempotency_key, execution_receipt, failure_reason, created_by, approved_at, approved_by, executed_at, parent_action_id, created_at, updated_at";

function toAction(row: Row): ApprovedLinkedInAction {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    prospectId: String(row["prospect_id"]),
    personId: String(row["person_id"]),
    contactId: String(row["contact_id"]),
    actionType: row["action_type"] as LinkiActionType,
    draftBody: String(row["draft_body"] ?? ""),
    channelContext: (row["channel_context"] ?? {}) as Record<string, unknown>,
    status: row["status"] as LinkiActionStatus,
    idempotencyKey: String(row["idempotency_key"]),
    executionReceipt: (row["execution_receipt"] ?? null) as LinkiExecutionReceipt | null,
    failureReason: row["failure_reason"] ? String(row["failure_reason"]) : null,
    createdBy: String(row["created_by"]),
    approvedAt: row["approved_at"] ? String(row["approved_at"]) : null,
    approvedBy: row["approved_by"] ? String(row["approved_by"]) : null,
    executedAt: row["executed_at"] ? String(row["executed_at"]) : null,
    parentActionId: row["parent_action_id"] ? String(row["parent_action_id"]) : null,
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"] ?? row["created_at"]),
  };
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export interface CreateLinkiActionInput {
  prospectId: ID;
  personId: ID;
  contactId: ID;
  actionType: LinkiActionType;
  draftBody: string;
  channelContext?: Record<string, unknown>;
  idempotencyKey: string;
  parentActionId?: ID;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateCreate(input: CreateLinkiActionInput, context: LinkiActionContext): void {
  const problems: string[] = [];
  if (!UUID_RE.test(input.prospectId)) problems.push("prospect_id must be a uuid");
  if (!UUID_RE.test(input.personId)) problems.push("person_id must be a uuid");
  if (!UUID_RE.test(input.contactId)) problems.push("contact_id must be a uuid");
  if (input.parentActionId && !UUID_RE.test(input.parentActionId)) {
    problems.push("parent_action_id must be a uuid");
  }
  if (input.actionType !== "connection_request" && input.actionType !== "message") {
    problems.push("action_type must be connection_request or message");
  }
  const body = input.draftBody.trim();
  if (body.length < 1) problems.push("draft_body is required (Comms owns the draft)");
  if (body.length > 3000) problems.push("draft_body is too long (3000 character max)");
  if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
    problems.push("idempotency_key is required (200 character max)");
  }
  if (!context.organizationId || !context.userId) {
    problems.push("organization and user context are required");
  }
  if (problems.length > 0) {
    throw new LinkiActionError("validation", problems.join("; "));
  }
}

/* ------------------------------------------------------------------ */
/* Daily caps                                                          */
/* ------------------------------------------------------------------ */

/** Local calendar day bucket (UTC date string) for same-day counting. */
export function dayBucketOf(timestamp: string): string {
  return timestamp.slice(0, 10);
}

export interface CapUsage {
  actionType: LinkiActionType;
  used: number;
  cap: number;
}

async function capUsage(
  organizationId: ID,
  actionType: LinkiActionType,
  env: Env,
  /** Exclude one action from the count (the one being executed). */
  excludeId?: ID,
): Promise<CapUsage> {
  const cap = linkiDailyCap(env, actionType);
  const today = dayBucketOf(new Date().toISOString());
  const { data, error } = await supabase
    .from("approved_linkedin_actions")
    .select("id, status, created_at")
    .eq("organization_id", organizationId)
    .eq("action_type", actionType)
    .gte("created_at", `${today}T00:00:00.000Z`)
    .lt("created_at", `${today}T23:59:59.999Z`);
  if (error) throw new LinkiActionError("send_failed", `Cap check failed: ${error.message}`);
  const used = (data ?? []).filter(
    (row) =>
      CAP_COUNTED_STATUSES.includes((row["status"] as LinkiActionStatus) ?? "") &&
      String(row["id"]) !== excludeId,
  ).length;
  return { actionType, used, cap };
}

function assertUnderCap(usage: CapUsage): void {
  if (usage.used >= usage.cap) {
    throw new LinkiActionError(
      "cap_exceeded",
      `Daily ${usage.actionType === "message" ? "message" : "connection"} limit reached for this workspace (${usage.used}/${usage.cap}). No further actions can be created today.`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* Service                                                             */
/* ------------------------------------------------------------------ */

export function createLinkiActionService(
  /** Activity stream (injected so tests can pass a fake). */
  activity: Pick<ActivityStream, "record">,
  /** Transport seam (injected; production passes linkiSendAction). */
  transport: LinkiTransport,
  env: Env = process.env,
  /** Clock seam for cap-window tests. */
  now: () => string = () => new Date().toISOString(),
) {
  async function audit(
    action: ApprovedLinkedInAction,
    context: LinkiActionContext,
    before: LinkiActionStatus,
    summary: string,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await activity.record({
      organizationId: action.organizationId,
      name: "linki.status_changed",
      subject: { type: "contact", id: action.personId },
      related: [
        { type: "prospect", id: action.prospectId },
        { type: "contact", id: action.contactId },
      ],
      summary,
      payload: {
        linki_action_id: action.id,
        action_type: action.actionType,
        status_before: before,
        status_after: action.status,
        receipt_hash: receiptHash(action.executionReceipt),
        idempotency_key: action.idempotencyKey,
        ...extra,
      },
      provenance: {
        appId: "linki",
        actor: { type: "user", id: context.userId },
        observedAt: now(),
        confidence: "observed",
      },
      occurredAt: now(),
    });
  }

  async function byId(id: ID, organizationId: ID): Promise<ApprovedLinkedInAction> {
    const { data, error } = await supabase
      .from("approved_linkedin_actions")
      .select(LINKI_ACTION_COLUMNS)
      .eq("id", id)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error) throw new LinkiActionError("send_failed", `Action lookup failed: ${error.message}`);
    if (!data) throw new LinkiActionError("not_found", "That LinkedIn action does not exist.");
    return toAction(data as Row);
  }

  async function fetchLinkedinUrl(contactId: ID, organizationId: ID): Promise<string> {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, organization_id, metadata")
      .eq("id", contactId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (error || !data) {
      throw new LinkiActionError(
        "validation",
        "The canonical contact for this action could not be verified.",
      );
    }
    const metadata = (data["metadata"] ?? {}) as Record<string, unknown>;
    const route = (metadata["linkedin_url"] ?? metadata["linkedinUrl"]) as string | undefined;
    if (typeof route !== "string" || route.trim().length === 0) {
      throw new LinkiActionError(
        "validation",
        "This person has no confirmed LinkedIn route. Confirm identity first — Linki never guesses.",
      );
    }
    return route.trim();
  }

  return {
    /**
     * Create a new governed action (from a Comms draft). Status starts at
     * pending_tai_approval; the daily cap is enforced BEFORE Tai is asked.
     */
    async create(
      input: CreateLinkiActionInput,
      context: LinkiActionContext,
    ): Promise<ApprovedLinkedInAction> {
      validateCreate(input, context);

      const usage = await capUsage(context.organizationId, input.actionType, env);
      assertUnderCap(usage);

      const existing = await supabase
        .from("approved_linkedin_actions")
        .select("id")
        .eq("organization_id", context.organizationId)
        .eq("idempotency_key", input.idempotencyKey)
        .maybeSingle();
      if (existing.data) {
        return byId(String((existing.data as Row)["id"]), context.organizationId);
      }

      await fetchLinkedinUrl(input.contactId, context.organizationId);

      const { data, error } = await supabase
        .from("approved_linkedin_actions")
        .insert({
          organization_id: context.organizationId,
          prospect_id: input.prospectId,
          person_id: input.personId,
          contact_id: input.contactId,
          action_type: input.actionType,
          draft_body: input.draftBody.trim(),
          channel_context: input.channelContext ?? null,
          status: "pending_tai_approval",
          idempotency_key: input.idempotencyKey,
          created_by: context.userId,
          parent_action_id: input.parentActionId ?? null,
        })
        .select(LINKI_ACTION_COLUMNS)
        .single();
      if (error) {
        // A unique-violation race on idempotency_key: return the original row.
        if (String(error.message ?? "").includes("duplicate key")) {
          const raced = await supabase
            .from("approved_linkedin_actions")
            .select(LINKI_ACTION_COLUMNS)
            .eq("organization_id", context.organizationId)
            .eq("idempotency_key", input.idempotencyKey)
            .maybeSingle();
          if (raced.data) return toAction(raced.data as Row);
        }
        throw new LinkiActionError("send_failed", `Could not save the action: ${error.message}`);
      }
      const action = toAction(data as Row);
      await audit(action, context, action.status, `LinkedIn ${action.actionType} prepared for Tai's approval (draft from Comms).`);
      return action;
    },

    /**
     * The human approval boundary. Only a workspace member can approve, and
     * the row must still be pending. Approver identity is stamped forever.
     */
    async approve(id: ID, context: LinkiActionContext): Promise<ApprovedLinkedInAction> {
      const action = await byId(id, context.organizationId);
      if (!canTransition(action.status, "approved")) {
        throw new LinkiActionError(
          "illegal_transition",
          `Action is ${action.status}; only pending actions can be approved.`,
        );
      }
      const at = now();
      const { data, error } = await supabase
        .from("approved_linkedin_actions")
        .update({ status: "approved", approved_at: at, approved_by: context.userId })
        .eq("id", id)
        .eq("organization_id", context.organizationId)
        .eq("status", "pending_tai_approval")
        .select(LINKI_ACTION_COLUMNS)
        .maybeSingle();
      if (error) throw new LinkiActionError("send_failed", `Approval failed: ${error.message}`);
      if (!data) {
        throw new LinkiActionError(
          "illegal_transition",
          "Action was not pending approval (it may have just changed).",
        );
      }
      const updated = toAction(data as Row);
      await audit(updated, context, action.status, `LinkedIn ${action.actionType} approved by Tai.`);
      return updated;
    },

    /**
     * Execute one approved action through Linki. THE ONLY SEND PATH.
     *
     * Guards, in order:
     *   1. kill switch (LINKI_EXECUTION_ENABLED) — hard 503 when off
     *   2. row status must be exactly `approved`
     *   3. caller must be the approver (the human who clicked)
     *   4. daily cap re-checked (it may have been hit since approval)
     *
     * Idempotency: if the row is already executing/executed/verified, the
     * EXISTING receipt is returned and Linki is never called again.
     */
    async execute(
      id: ID,
      context: LinkiActionContext,
    ): Promise<{ action: ApprovedLinkedInAction; alreadyDone: boolean }> {
      if (!linkiExecutionEnabled(env)) {
        throw new LinkiActionError(
          "kill_switch",
          "LinkedIn execution is disabled (LINKI_EXECUTION_ENABLED is off). Nothing was sent.",
        );
      }

      const action = await byId(id, context.organizationId);

      if (action.status === "executing" || action.status === "executed" || action.status === "verified") {
        return { action, alreadyDone: true };
      }
      if (action.status !== "approved") {
        throw new LinkiActionError(
          "illegal_transition",
          `Action is ${action.status}; only approved actions can execute.`,
        );
      }
      if (action.approvedBy !== context.userId) {
        throw new LinkiActionError(
          "forbidden",
          "Only the person who approved this action may trigger its execution.",
        );
      }

      // Cap re-check, excluding this action itself (it already earned its
      // slot when it was created and approved).
      const usage = await capUsage(context.organizationId, action.actionType, env, action.id);
      assertUnderCap(usage);

      const moved = await supabase
        .from("approved_linkedin_actions")
        .update({ status: "executing" })
        .eq("id", id)
        .eq("organization_id", context.organizationId)
        .eq("status", "approved")
        .select(LINKI_ACTION_COLUMNS)
        .maybeSingle();
      if (!moved.data) {
        throw new LinkiActionError(
          "illegal_transition",
          "Action was not in approved state when execution started (it may have just changed).",
        );
      }
      const executing = toAction(moved.data as Row);
      await audit(executing, context, "approved", "LinkedIn execution started (Linki transport).");

      try {
        const linkedinUrl = await fetchLinkedinUrl(action.contactId, context.organizationId);
        const { receipt } = await transport(
          {
            actionType: action.actionType,
            linkedinUrl,
            draftBody: action.draftBody,
            idempotencyKey: action.idempotencyKey,
          },
          env,
        );
        const executedAt = now();
        const { data, error } = await supabase
          .from("approved_linkedin_actions")
          .update({ status: "executed", execution_receipt: receipt, executed_at: executedAt })
          .eq("id", id)
          .eq("organization_id", context.organizationId)
          .eq("status", "executing")
          .select(LINKI_ACTION_COLUMNS)
          .maybeSingle();
        if (error || !data) {
          // DANGER PATH: the send DID happen but the receipt could not be
          // persisted. Marking this `failed` would invite a retry — and a
          // retry uses a NEW idempotency key, so Linki would double-send.
          // Fail closed instead: the row stays in `executing`, which the
          // idempotency guard treats as already-done, and a human resolves
          // the row by hand. Never automatically re-send.
          await audit(
            executing,
            context,
            "executing",
            "LinkedIn send SUCCEEDED but the receipt could not be saved. Row held in executing for manual review — do NOT retry blindly.",
            { receipt_unsaved: true, error: error?.message ?? "row vanished" },
          );
          throw new LinkiReceiptUnsavedError(
            `The LinkedIn send happened but its receipt could not be saved (${error?.message ?? "row vanished"}). The action is held in executing state for manual review. Do not retry automatically.`,
          );
        }
        const executed = toAction(data as Row);
        await audit(executed, context, "executing", "LinkedIn action executed via Linki.");
        return { action: executed, alreadyDone: false };
      } catch (error) {
        // Receipt-write danger path already audited + thrown above; never
        // let it fall through into the failure branch (which would invite a
        // double-sending retry).
        if (error instanceof LinkiReceiptUnsavedError) {
          throw new LinkiActionError("send_failed", error.message);
        }
        const message =
          error instanceof Error ? error.message : "Linki execution failed for an unknown reason.";
        await supabase
          .from("approved_linkedin_actions")
          .update({ status: "failed", failure_reason: message })
          .eq("id", id)
          .eq("organization_id", context.organizationId)
          .eq("status", "executing")
          .then(() => undefined, () => undefined);
        const failed: ApprovedLinkedInAction = {
          ...executing,
          status: "failed",
          failureReason: message,
        };
        await audit(
          failed,
          context,
          "executing",
          "LinkedIn action FAILED at the Linki boundary. It is terminal; retries create a new action.",
          { failure_reason: message },
        );
        throw new LinkiActionError("send_failed", message);
      }
    },

    /** Human/observed confirmation that the send really landed. */
    async verify(id: ID, context: LinkiActionContext): Promise<ApprovedLinkedInAction> {
      const action = await byId(id, context.organizationId);
      if (!canTransition(action.status, "verified")) {
        throw new LinkiActionError(
          "illegal_transition",
          `Action is ${action.status}; only executed actions can be verified.`,
        );
      }
      const { data, error } = await supabase
        .from("approved_linkedin_actions")
        .update({ status: "verified" })
        .eq("id", id)
        .eq("organization_id", context.organizationId)
        .eq("status", "executed")
        .select(LINKI_ACTION_COLUMNS)
        .maybeSingle();
      if (error) throw new LinkiActionError("send_failed", `Verify failed: ${error.message}`);
      if (!data) {
        throw new LinkiActionError("illegal_transition", "Action was not in executed state.");
      }
      const verified = toAction(data as Row);
      await audit(verified, context, "executed", "LinkedIn action verified as landed.");
      return verified;
    },

    /**
     * Retry = a NEW action row referencing the failed original. The failed
     * row is terminal and can never execute again.
     */
    async retry(
      id: ID,
      context: LinkiActionContext,
      overrides?: { draftBody?: string; channelContext?: Record<string, unknown> },
    ): Promise<ApprovedLinkedInAction> {
      const original = await byId(id, context.organizationId);
      if (original.status !== "failed") {
        throw new LinkiActionError(
          "illegal_transition",
          `Only failed actions can be retried; this one is ${original.status}.`,
        );
      }
      const stamp = now().replace(/[^0-9]/g, "");
      const suffix = `:retry:${stamp}`;
      const baseKey = original.idempotencyKey.slice(0, 200 - suffix.length);
      return this.create(
        {
          prospectId: original.prospectId,
          personId: original.personId,
          contactId: original.contactId,
          actionType: original.actionType,
          draftBody: overrides?.draftBody ?? original.draftBody,
          channelContext: overrides?.channelContext ?? original.channelContext,
          idempotencyKey: `${baseKey}${suffix}`,
          parentActionId: original.id,
        },
        context,
      );
    },

    capUsage: (organizationId: ID, actionType: LinkiActionType) =>
      capUsage(organizationId, actionType, env),
  };
}

/** Internal marker: the transport send succeeded but the receipt write failed. */
class LinkiReceiptUnsavedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkiReceiptUnsavedError";
  }
}

export { linkiActionErrorStatus };
