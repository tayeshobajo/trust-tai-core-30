/**
 * Persistence for the Conductor's control loop.
 *
 * Two tables, both governance: `conductor_actions` (what was proposed and what
 * a person decided about it) and `conductor_receipts` (what was handed to a
 * room, when, by whose approval, through which boundary). Neither holds a copy
 * of a prospect, relationship, roadmap, project or asset, only references.
 *
 * Every read is organization-scoped in the query as well as by RLS. A missing
 * table reads as an empty ledger so the Conductor still answers, and refuses
 * to *write* with the migration named rather than failing silently.
 */

import { supabase } from "@/integrations/trust-tai/supabase";
import type { ID } from "@/domain/entities";
import type {
  ActionLifecycleState,
  ControlledAction,
  ExecutionReceipt,
} from "@/domain/conductor-control";

type Row = Record<string, unknown>;

const MISSING =
  "The Conductor control ledger is not in this database yet. Apply docs/conductor-v2-schema.sql.";

function text(row: Row, key: string): string | undefined {
  const value = row[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function json<T>(row: Row, key: string, fallback: T): T {
  const value = row[key];
  return value === null || value === undefined ? fallback : (value as T);
}

/* ------------------------------------------------------------- actions */

function toAction(row: Row): ControlledAction {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    ...(text(row, "answer_id") ? { answerId: text(row, "answer_id")! } : {}),
    ...(text(row, "plan_id") ? { planId: text(row, "plan_id")! } : {}),
    ...(text(row, "graph_id") ? { graphId: text(row, "graph_id")! } : {}),
    ...(text(row, "proposal_id") ? { proposalId: text(row, "proposal_id")! } : {}),
    owningApp: text(row, "owning_app") ?? "unknown",
    operation: text(row, "operation") ?? "unknown",
    ...(row["payload"] ? { payload: json<Record<string, unknown>>(row, "payload", {}) } : {}),
    intent: text(row, "intent") ?? "",
    whyItMatters: text(row, "why_it_matters") ?? "",
    evidence: json(row, "evidence", []),
    dependsOn: json(row, "depends_on", [] as string[]),
    consequence: (text(row, "consequence") ?? "internal_change") as ControlledAction["consequence"],
    requiresApproval: row["requires_approval"] !== false,
    requiredCapability: text(row, "required_capability") ?? "workspace.read",
    route: text(row, "route") ?? "/modules/conductor",
    routeLabel: text(row, "route_label") ?? "Open the owning room",
    boundary: json(row, "boundary", { willDo: [], willNotDo: [] }),
    expectedSignal: json(row, "expected_signal", {
      statement: "No signal declared.",
      observedIn: text(row, "owning_app") ?? "unknown",
    }),
    sourceEventKey: text(row, "source_event_key") ?? String(row["id"]),
    status: (text(row, "status") ?? "proposed") as ActionLifecycleState,
    ...(row["approval"] ? { approval: json(row, "approval", undefined as never) } : {}),
    ...(text(row, "routed_at") ? { routedAt: text(row, "routed_at")! } : {}),
    ...(text(row, "receipt_id") ? { receiptId: text(row, "receipt_id")! } : {}),
    ...(row["outcome"] ? { outcome: json(row, "outcome", undefined as never) } : {}),
    createdAt: text(row, "created_at") ?? new Date().toISOString(),
  };
}

function toRow(action: ControlledAction): Row {
  return {
    id: action.id,
    organization_id: action.organizationId,
    answer_id: action.answerId ?? null,
    plan_id: action.planId ?? null,
    graph_id: action.graphId ?? null,
    proposal_id: action.proposalId ?? null,
    owning_app: action.owningApp,
    operation: action.operation,
    payload: action.payload ?? null,
    intent: action.intent,
    why_it_matters: action.whyItMatters,
    evidence: action.evidence,
    depends_on: action.dependsOn,
    consequence: action.consequence,
    requires_approval: action.requiresApproval,
    required_capability: action.requiredCapability,
    route: action.route,
    route_label: action.routeLabel,
    boundary: action.boundary,
    expected_signal: action.expectedSignal,
    source_event_key: action.sourceEventKey,
    status: action.status,
    approval: action.approval ?? null,
    routed_at: action.routedAt ?? null,
    receipt_id: action.receiptId ?? null,
    outcome: action.outcome ?? null,
    created_at: action.createdAt,
  };
}

/** Every governed action for one organization, newest first. */
export async function loadControlledActions(organizationId: ID): Promise<ControlledAction[]> {
  const { data, error } = await supabase
    .from("conductor_actions")
    .select("*")
    .eq("organization_id", organizationId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => toAction(row as Row));
}

/**
 * Persist proposed actions.
 *
 * Conflict on `source_event_key` is a no-op update of the same row, so asking
 * the same question twice never creates a second copy of the same action.
 */
export async function saveControlledActions(
  actions: ControlledAction[],
): Promise<ControlledAction[]> {
  if (actions.length === 0) return [];
  const { data, error } = await supabase
    .from("conductor_actions")
    .upsert(actions.map(toRow), { onConflict: "organization_id,source_event_key" })
    .select("*");
  if (error) throw new Error(error.message.includes("does not exist") ? MISSING : error.message);
  return (data ?? []).map((row) => toAction(row as Row));
}

/** Write one action's new state. The caller has already validated the move. */
export async function persistActionState(action: ControlledAction): Promise<ControlledAction> {
  const { data, error } = await supabase
    .from("conductor_actions")
    .update({
      status: action.status,
      approval: action.approval ?? null,
      routed_at: action.routedAt ?? null,
      receipt_id: action.receiptId ?? null,
      outcome: action.outcome ?? null,
    })
    .eq("id", action.id)
    .eq("organization_id", action.organizationId)
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message.includes("does not exist") ? MISSING : error.message);
  return data ? toAction(data as Row) : action;
}

/* ------------------------------------------------------------ receipts */

function toReceipt(row: Row): ExecutionReceipt {
  return {
    id: String(row["id"]),
    organizationId: String(row["organization_id"]),
    actionId: String(row["action_id"]),
    owningApp: text(row, "owning_app") ?? "unknown",
    adapterId: text(row, "adapter_id") ?? "unknown",
    boundaryCrossed: text(row, "boundary_crossed") ?? "",
    routedAt: text(row, "routed_at") ?? new Date().toISOString(),
    approvedBy: json(row, "approved_by", { id: "", label: "Unknown" }),
    routedBy: json(row, "routed_by", { id: "", label: "Unknown" }),
    sourceEventKey: text(row, "source_event_key") ?? "",
    status: (text(row, "status") ?? "failed") as ExecutionReceipt["status"],
    ...(row["result"] ? { result: json(row, "result", undefined as never) } : {}),
    ...(text(row, "failure") ? { failure: text(row, "failure")! } : {}),
    resultingState: (text(row, "resulting_state") ?? "approved") as ActionLifecycleState,
  };
}

export async function loadReceipts(organizationId: ID): Promise<ExecutionReceipt[]> {
  const { data, error } = await supabase
    .from("conductor_receipts")
    .select("*")
    .eq("organization_id", organizationId)
    .order("routed_at", { ascending: false })
    .limit(200);
  if (error) return [];
  return (data ?? []).map((row) => toReceipt(row as Row));
}

/**
 * Record a receipt. Unique on `source_event_key`, so a retried route writes no
 * second receipt and cannot double-hand the same work to a room.
 */
export async function recordReceipt(receipt: ExecutionReceipt): Promise<ExecutionReceipt> {
  const { data, error } = await supabase
    .from("conductor_receipts")
    .upsert(
      {
        id: receipt.id,
        organization_id: receipt.organizationId,
        action_id: receipt.actionId,
        owning_app: receipt.owningApp,
        adapter_id: receipt.adapterId,
        boundary_crossed: receipt.boundaryCrossed,
        routed_at: receipt.routedAt,
        approved_by: receipt.approvedBy,
        routed_by: receipt.routedBy,
        source_event_key: receipt.sourceEventKey,
        status: receipt.status,
        result: receipt.result ?? null,
        failure: receipt.failure ?? null,
        resulting_state: receipt.resultingState,
      },
      { onConflict: "organization_id,source_event_key" },
    )
    .select("*")
    .maybeSingle();
  if (error) throw new Error(error.message.includes("does not exist") ? MISSING : error.message);
  return data ? toReceipt(data as Row) : receipt;
}
